import {
  computeCoverage, DEFAULT_TARGETS, DIFFICULTY_LABEL, effectsOf, zonedParts, GROUP_SIZE, groupsFor, isRaidSize, isValidSpecFor, LOOT_MODES, RAID_GROUPS, RETAIL_DIFFICULTIES,
  retailDefaultSize, retailSizeRange, retailTargets, type Game, type RaidSize, type RetailDifficulty,
} from "@forever/game-data";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characters, groupCharacters, groupMembers, groups, raids, raidSignups, raidTemplates, users, type RaidSlot } from "../db/schema";
import { listSignups, signupInput, signupSummary, signUpSiteUser, touchRaid } from "../lib/signups";
import { discordDeletions } from "../db/schema";
import { SIGNUP_STATUSES } from "@forever/game-data";
import { audit } from "../lib/audit";
import { membership, requireRole } from "../lib/groups";
import { badRequest, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { ensureRecurringRaids, MAX_RAIDS_PER_GROUP, MAX_TEMPLATES_PER_GROUP } from "../lib/recurring";
import { inheritPrep } from "../lib/prep";
import { applyAbsencesToRaid } from "../lib/absences";
import { mergeSlots, slotKey } from "../lib/compo";
import { bus } from "../lib/events";
import { raidLogView } from "./raidlogs";

const raidParams = z.object({ id: z.uuid(), raidId: z.uuid() });
const raidFields = z.object({
  name: z.string().trim().min(2).max(60),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
  description: z.string().trim().max(1000).optional(),
  /** Mode de butin (choisi à la création, modifiable ensuite) et réservations cachées jusqu'à la fermeture. */
  lootMode: z.enum(LOOT_MODES).optional(),
  srHidden: z.boolean().optional(),
  /** Format du raid : 10, 20 ou 40 joueurs sur Forever ; sur Roster, effectif selon la difficulté (formatFor). */
  size: z.int().min(5).max(40).optional(),
  /** Roster (WoW Retail) : Normal, Héroïque ou Mythique. */
  difficulty: z.enum(RETAIL_DIFFICULTIES).nullable().optional(),
});
const targetsInput = z.object({ tank: z.int().min(0).max(40), heal: z.int().min(0).max(40), dps: z.int().min(0).max(40) });
/** Rôles visés d'un raid : les siens, sinon ceux de son format (Forever) ou de son effectif (Roster). */
export const targetsOf = (r: { size: number; targets: { tank: number; heal: number; dps: number } | null }, game: Game = "forever") =>
  r.targets ?? (game === "retail" ? retailTargets(r.size) : DEFAULT_TARGETS[(isRaidSize(r.size) ? r.size : 40) as RaidSize]);

/**
 * Format d'un raid selon le jeu : Forever 10, 20 ou 40 joueurs, sans difficulté ; Roster, difficulté (Normal par défaut)
 * et effectif dans la plage de la difficulté (10 à 30, Mythique 20 ou flexible selon le raid).
 */
export function formatFor(game: Game, name: string, size?: number, difficulty?: RetailDifficulty | null): { size: number; difficulty: RetailDifficulty | null } {
  if (game !== "retail") {
    if (difficulty) throw badRequest("Pas de difficulté pour les raids de WoW Forever.");
    const s = size ?? 40;
    if (!isRaidSize(s)) throw badRequest("Un raid de WoW Forever se joue à 10, 20 ou 40.");
    return { size: s, difficulty: null };
  }
  const d = difficulty ?? "normal";
  const { min, max } = retailSizeRange(d, name);
  const s = size ?? retailDefaultSize(d, name);
  if (s < min || s > max) throw badRequest(min === max ? `En ${DIFFICULTY_LABEL[d].fr}, ce raid se joue à ${min}.` : `En ${DIFFICULTY_LABEL[d].fr}, de ${min} à ${max} joueurs.`);
  return { size: s, difficulty: d };
}
const slot = z.object({
  group: z.int().min(1).max(RAID_GROUPS), pos: z.int().min(1).max(GROUP_SIZE),
  characterId: z.uuid().optional(), signupId: z.uuid().optional(),
}).refine(s => !!s.characterId !== !!s.signupId, "Une place contient un perso ou un inscrit sans compte.");


export async function raidRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  async function loadRaid(groupId: string, raidId: string) {
    const [row] = await db.select({ r: raids, game: groups.game }).from(raids).innerJoin(groups, eq(groups.id, raids.groupId))
      .where(and(eq(raids.id, raidId), eq(raids.groupId, groupId)));
    if (!row) throw notFound("Raid introuvable.");
    return { ...row.r, game: row.game };
  }
  async function groupGame(groupId: string): Promise<Game> {
    const [g] = await db.select({ game: groups.game }).from(groups).where(eq(groups.id, groupId));
    return g?.game ?? "forever";
  }

  async function slotCharacters(groupId: string, slots: RaidSlot[]) {
    const ids = slots.flatMap(s => (s.characterId ? [s.characterId] : []));
    if (!ids.length) return [];
    return db.select({ id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1, level: characters.level, race: characters.race, owner: users.displayName })
      .from(characters)
      .innerJoin(groupCharacters, and(eq(groupCharacters.characterId, characters.id), eq(groupCharacters.groupId, groupId)))
      .innerJoin(users, eq(users.id, characters.userId))
      .where(inArray(characters.id, ids));
  }

  /** Spé retenue pour chaque perso inscrit (elle peut différer de sa spé principale). */
  async function signupSpecs(raidId: string) {
    const rows = await db.select({ characterId: raidSignups.characterId, spec: raidSignups.spec }).from(raidSignups).where(eq(raidSignups.raidId, raidId));
    return new Map(rows.filter(r => r.characterId && r.spec).map(r => [r.characterId!, r.spec]));
  }

  /** Inscriptions libres (sans compte) placées dans la compo : classe et spé choisies sur Discord. */
  async function slotGuests(raidId: string, slots: RaidSlot[]) {
    const ids = slots.flatMap(s => (s.signupId ? [s.signupId] : []));
    if (!ids.length) return [];
    return db.select({ id: raidSignups.id, cls: raidSignups.cls, spec: raidSignups.spec }).from(raidSignups)
      .where(and(eq(raidSignups.raidId, raidId), inArray(raidSignups.id, ids), isNull(raidSignups.userId)));
  }

  function withCoverage(game: Game, slots: RaidSlot[], chars: Awaited<ReturnType<typeof slotCharacters>>, guests: Awaited<ReturnType<typeof slotGuests>>, specs = new Map<string, string>()) {
    const byId = new Map(chars.map(c => [c.id, c]));
    const guestById = new Map(guests.map(g => [g.id, g]));
    // Un perso dont le joueur a quitté le groupe, ou un inscrit sans compte désinscrit, disparaît de la composition.
    const live = slots.filter(s => (s.characterId ? byId.has(s.characterId) : guestById.has(s.signupId!)));
    const coverage = computeCoverage(live.map(s => {
      if (s.signupId) { const g = guestById.get(s.signupId)!; return { characterId: `s:${g.id}`, cls: g.cls, spec: g.spec || null, group: s.group }; }
      const c = byId.get(s.characterId!)!;
      return { characterId: c.id, cls: c.cls, spec: specs.get(c.id) || c.spec1 || null, group: s.group };
    }), effectsOf(game));
    return { slots: live, characters: chars, coverage: coverage.map(c => ({ id: c.effect.id, covered: c.covered, sources: c.sources, missingGroups: c.missingGroups })) };
  }

  app.get("/:id/raids", async (req) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await membership(db, id, u.id);
    const rows = await db.select({ id: raids.id, name: raids.name, scheduledAt: raids.scheduledAt, slots: raids.slots, updatedAt: raids.updatedAt, templateId: raids.templateId, size: raids.size, difficulty: raids.difficulty, lootMode: raids.lootMode })
      .from(raids).where(eq(raids.groupId, id)).orderBy(desc(raids.scheduledAt), asc(raids.name));
    const summary = await signupSummary(db, rows.map(r => r.id), u.id);
    return { raids: rows.map(r => ({
      id: r.id, name: r.name, scheduledAt: r.scheduledAt, filled: r.slots.length, size: r.size, difficulty: r.difficulty, updatedAt: r.updatedAt, recurring: !!r.templateId, lootMode: r.lootMode,
      signups: summary.get(r.id)?.counts ?? {}, mySignup: summary.get(r.id)?.mine ?? null, roles: summary.get(r.id)?.roles ?? { Tank: 0, Heal: 0, DPS: 0 },
    })) };
  });

  app.post("/:id/raids", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await requireRole(db, id, u.id, "officer");
    // « Chaque semaine » (lot E) : le raid devient aussi un raid récurrent, créé `leadDays` jours à l'avance
    const body = parse(raidFields.extend({ weekly: z.object({ leadDays: z.int().min(1).max(28) }).optional() }), req.body);
    const existing = await db.select({ id: raids.id }).from(raids).where(eq(raids.groupId, id));
    if (existing.length >= MAX_RAIDS_PER_GROUP) throw badRequest(`Limite de ${MAX_RAIDS_PER_GROUP} raids atteinte.`);
    if (body.weekly) {
      if (!body.scheduledAt) throw badRequest("Choisis la date du premier raid.");
      if (await db.$count(raidTemplates, eq(raidTemplates.groupId, id)) >= MAX_TEMPLATES_PER_GROUP) throw badRequest(`Limite de ${MAX_TEMPLATES_PER_GROUP} raids récurrents atteinte.`);
    }
    const format = formatFor(await groupGame(id), body.name, body.size, body.difficulty);
    const [r] = await db.insert(raids).values({
      groupId: id, name: body.name, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null, description: body.description ?? "", createdBy: u.id,
      lootMode: body.lootMode ?? "journal", srHidden: body.srHidden ?? false, ...format,
    }).returning();
    await audit(db, req, "raid_created", { userId: u.id, groupId: id, meta: { raidId: r!.id, name: body.name } });
    // Consommables, fiches de boss et conseil repris du dernier raid du même nom (lot G)
    await inheritPrep(db, [r!.id]);
    if (body.weekly && r!.scheduledAt) {
      // Même jour, même heure (de Paris) chaque semaine ; ce raid est la première occurrence
      const z = zonedParts(r!.scheduledAt);
      const time = `${String(z.hour).padStart(2, "0")}:${String(z.minute).padStart(2, "0")}`;
      const [t] = await db.insert(raidTemplates).values({
        groupId: id, name: r!.name, description: r!.description, weekday: z.weekday, time, leadDays: body.weekly.leadDays,
        size: r!.size, difficulty: r!.difficulty, lootMode: r!.lootMode, srHidden: r!.srHidden, createdBy: u.id, generatedUntil: r!.scheduledAt,
      }).returning();
      await db.update(raids).set({ templateId: t!.id }).where(eq(raids.id, r!.id));
      await ensureRecurringRaids(db, new Date(), t!.id);
      await audit(db, req, "raid_template_created", { userId: u.id, groupId: id, meta: { templateId: t!.id, name: t!.name, weekday: t!.weekday, time } });
    }
    // Membres qui ont déclaré une absence ce jour-là : « Absent » d'office
    await applyAbsencesToRaid(db, r!.id);
    bus.group({ t: "raids", g: id });
    return reply.code(201).send({ raid: { id: r!.id } });
  });

  app.get("/:id/raids/:raidId", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    const role = await membership(db, p.id, u.id);
    const r = await loadRaid(p.id, p.raidId);
    const chars = await slotCharacters(p.id, r.slots);
    const signups = await listSignups(db, r.id);
    return {
      raid: { id: r.id, name: r.name, scheduledAt: r.scheduledAt, description: r.description, updatedAt: r.updatedAt, rosterPublished: !!r.rosterPublishedAt, lootMode: r.lootMode, srHidden: r.srHidden,
        size: r.size, difficulty: r.difficulty, targets: targetsOf(r, r.game), customTargets: !!r.targets },
      version: r.updatedAt.toISOString(),
      canEdit: role !== "member", ...withCoverage(r.game, r.slots, chars, await slotGuests(r.id, r.slots), await signupSpecs(r.id)),
      signups: signups.map(x => ({ ...x, mine: x.userId === u.id })),
      log: await raidLogView(db, r),
    };
  });

  /**
   * Enregistre la compo et les infos du raid. Avec `base` (la version sur laquelle la page a travaillé),
   * les modifications faites entre-temps par un autre officier sont fusionnées ; en cas de conflit : 409.
   */
  app.put("/:id/raids/:raidId", async (req, reply) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const current = await loadRaid(p.id, p.raidId);
    const body = parse(raidFields.extend({
      slots: z.array(slot).max(RAID_GROUPS * GROUP_SIZE),
      base: z.object({
        version: z.string().max(40), slots: z.array(slot).max(RAID_GROUPS * GROUP_SIZE),
        name: z.string().max(60), scheduledAt: z.string().max(40).nullable(), description: z.string().max(1000),
      }).optional(),
    }), req.body);

    let slots = body.slots, name = body.name, scheduledAtIso = body.scheduledAt ?? null, description = body.description;
    let merged = false;
    if (body.base && body.base.version !== current.updatedAt.toISOString()) {
      // Compo actuelle, sans les places devenues vides (joueur parti, inscrit désinscrit)
      const liveChars = new Set((await slotCharacters(p.id, current.slots)).map(c => c.id));
      const liveGuests = new Set((await slotGuests(p.raidId, current.slots)).map(g => g.id));
      const theirs = current.slots.filter(x => (x.characterId ? liveChars.has(x.characterId) : liveGuests.has(x.signupId!)));
      const m = mergeSlots(body.base.slots, body.slots, theirs);
      if (!m.ok) return reply.code(409).send({ error: `${m.reason} La compo a été rechargée : refais ton dernier déplacement.`, conflict: true });
      slots = m.slots;
      // Infos du raid : seuls les champs changés sur cette page s'appliquent
      const curIso = current.scheduledAt?.toISOString() ?? null;
      if (body.name === body.base.name) name = current.name;
      if ((body.scheduledAt ?? null) === body.base.scheduledAt) scheduledAtIso = curIso;
      if ((body.description ?? "") === body.base.description) description = current.description;
      merged = true;
    }

    if (slots.some(s => s.group > groupsFor(current.size))) throw badRequest(`Ce raid est à ${current.size} : ${groupsFor(current.size)} groupes au plus.`);
    const seatKeys = new Set(slots.map(s => `${s.group}:${s.pos}`));
    if (seatKeys.size !== slots.length) throw badRequest("Deux personnages occupent la même place.");
    if (new Set(slots.map(slotKey)).size !== slots.length) throw badRequest("Un personnage ne peut occuper qu'une place.");
    const chars = await slotCharacters(p.id, slots);
    if (chars.length !== slots.filter(s => s.characterId).length) throw badRequest("Certains personnages n'appartiennent pas à un membre du groupe.");
    const guests = await slotGuests(p.raidId, slots);
    if (guests.length !== slots.filter(s => s.signupId).length) throw badRequest("Certains inscrits sans compte ne sont pas inscrits à ce raid.");

    const scheduledAt = scheduledAtIso ? new Date(scheduledAtIso) : null;
    const moved = (scheduledAt?.getTime() ?? null) !== (current.scheduledAt?.getTime() ?? null);
    const updatedAt = new Date();
    await db.update(raids).set({
      name, scheduledAt, slots, updatedAt,
      // Nouvelle date : le rappel de la veille sera renvoyé
      ...(moved && { reminderSentAt: null, nudgeAutoAt: null }),
      ...(description !== undefined && { description }),
      ...(body.lootMode && { lootMode: body.lootMode }),
      ...(body.srHidden !== undefined && { srHidden: body.srHidden }),
      discordChangedAt: new Date(),
    }).where(eq(raids.id, p.raidId));
    if (moved) await applyAbsencesToRaid(db, p.raidId);
    // Raid renommé avant d'être préparé : préparation reprise du raid qui porte le nouveau nom (lot G)
    if (name !== current.name && !current.prep.consumables.length && !current.prep.bosses.length) await inheritPrep(db, [p.raidId]);
    bus.group({ t: "raid", g: p.id, r: p.raidId, by: u.id, byName: u.displayName });
    return {
      ...withCoverage(current.game, slots, chars, guests, await signupSpecs(p.raidId)),
      version: updatedAt.toISOString(), merged,
      raid: { name, scheduledAt: scheduledAt?.toISOString() ?? null, description: description ?? current.description, lootMode: body.lootMode ?? current.lootMode, srHidden: body.srHidden ?? current.srHidden },
    };
  });

  /** Officiers : afficher (ou retirer) la composition dans l'annonce Discord. */
  app.post("/:id/raids/:raidId/roster", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    await db.update(raids).set({ rosterPublishedAt: new Date(), discordChangedAt: new Date() }).where(eq(raids.id, r.id));
    await audit(db, req, "raid_roster_published", { userId: u.id, groupId: p.id, meta: { raidId: r.id, name: r.name } });
    bus.group({ t: "raid", g: p.id, r: r.id, by: u.id, byName: u.displayName });
    return { rosterPublished: true };
  });

  app.delete("/:id/raids/:raidId/roster", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    await db.update(raids).set({ rosterPublishedAt: null, discordChangedAt: new Date() }).where(eq(raids.id, r.id));
    await audit(db, req, "raid_roster_unpublished", { userId: u.id, groupId: p.id, meta: { raidId: r.id, name: r.name } });
    bus.group({ t: "raid", g: p.id, r: r.id, by: u.id, byName: u.displayName });
    return { rosterPublished: false };
  });

  /* ----- Inscriptions ----- */

  app.put("/:id/raids/:raidId/signup", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await membership(db, p.id, u.id);
    await loadRaid(p.id, p.raidId);
    const input = parse(signupInput, req.body);
    await signUpSiteUser(db, p.raidId, { id: u.id, displayName: u.displayName }, input);
    return { signups: (await listSignups(db, p.raidId)).map(x => ({ ...x, mine: x.userId === u.id })) };
  });

  app.delete("/:id/raids/:raidId/signup", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await membership(db, p.id, u.id);
    await loadRaid(p.id, p.raidId);
    await db.delete(raidSignups).where(and(eq(raidSignups.raidId, p.raidId), eq(raidSignups.userId, u.id)));
    await touchRaid(db, p.raidId);
    return { ok: true };
  });

  /** Officiers : format du raid (10, 20, 40 ; Roster : difficulté et effectif) et rôles visés (null : ceux du format). */
  app.patch("/:id/raids/:raidId/format", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    const body = parse(z.object({ size: raidFields.shape.size, difficulty: raidFields.shape.difficulty, targets: targetsInput.nullable().optional() }), req.body);
    // Nouvelle difficulté sans effectif : celui proposé pour cette difficulté
    const changedDifficulty = body.difficulty !== undefined && body.difficulty !== r.difficulty;
    const { size, difficulty } = formatFor(r.game, r.name, body.size ?? (changedDifficulty ? undefined : r.size), body.difficulty === undefined ? r.difficulty : body.difficulty);
    const beyond = [...new Set(r.slots.filter(s => s.group > groupsFor(size)).map(s => s.group))];
    if (beyond.length) throw badRequest(`Des persos sont placés dans le${beyond.length > 1 ? "s groupes" : " groupe"} ${beyond.join(", ")} : retire-les avant de passer à ${size}.`);
    const targets = body.targets === undefined ? r.targets : body.targets;
    await db.update(raids).set({ size, difficulty, targets, discordChangedAt: new Date() }).where(eq(raids.id, r.id));
    bus.group({ t: "raid", g: p.id, r: r.id });
    return { size, difficulty, targets: targetsOf({ size, targets }, r.game), customTargets: !!targets };
  });

  /**
   * Bancs passés des inscrits (rotation du banc) : sur les 8 raids précédents du groupe, combien de fois chaque perso
   * inscrit a été mis sur le banc, et s'il l'était au raid précédent (il est alors protégé).
   */
  app.get("/:id/raids/:raidId/bench-history", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await membership(db, p.id, u.id);
    const r = await loadRaid(p.id, p.raidId);
    if (!r.scheduledAt) return { raids: 0, stats: {} };
    const prev = await db.select({ id: raids.id }).from(raids)
      .where(and(eq(raids.groupId, p.id), lt(raids.scheduledAt, r.scheduledAt))).orderBy(desc(raids.scheduledAt)).limit(8);
    if (!prev.length) return { raids: 0, stats: {} };
    const rows = await db.select({ raidId: raidSignups.raidId, characterId: raidSignups.characterId, status: raidSignups.status }).from(raidSignups)
      .where(and(inArray(raidSignups.raidId, prev.map(x => x.id)), isNotNull(raidSignups.characterId)));
    const stats: Record<string, { bench: number; signed: number; lastBenched: boolean }> = {};
    for (const row of rows) {
      const s = (stats[row.characterId!] ??= { bench: 0, signed: 0, lastBenched: false });
      if (row.status !== "absent") s.signed++;
      if (row.status === "bench") { s.bench++; if (row.raidId === prev[0]!.id) s.lastBenched = true; }
    }
    return { raids: prev.length, stats };
  });

  /** Officiers : changer le statut d'un inscrit (ex. le passer sur le banc), sa spé, ou retirer une inscription. */
  const signupParams = raidParams.extend({ signupId: z.uuid() });
  app.patch("/:id/raids/:raidId/signups/:signupId", async (req) => {
    const u = currentUser(req);
    const p = parse(signupParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    await loadRaid(p.id, p.raidId);
    const body = parse(z.object({ status: z.enum(SIGNUP_STATUSES).optional(), spec: z.string().trim().max(20).optional() })
      .refine(b => b.status || b.spec, "Rien à changer."), req.body);
    const [cur] = await db.select({ cls: raidSignups.cls }).from(raidSignups).where(and(eq(raidSignups.id, p.signupId), eq(raidSignups.raidId, p.raidId)));
    if (!cur) throw notFound("Inscription introuvable.");
    if (body.spec && !isValidSpecFor(await groupGame(p.id), cur.cls, body.spec)) throw badRequest(`La spé « ${body.spec} » n'existe pas pour ${cur.cls}.`);
    const [row] = await db.update(raidSignups).set({ ...(body.status && { status: body.status }), ...(body.spec && { spec: body.spec }), updatedAt: new Date() })
      .where(and(eq(raidSignups.id, p.signupId), eq(raidSignups.raidId, p.raidId))).returning({ id: raidSignups.id });
    if (!row) throw notFound("Inscription introuvable.");
    await touchRaid(db, p.raidId);
    return { ok: true };
  });

  app.delete("/:id/raids/:raidId/signups/:signupId", async (req) => {
    const u = currentUser(req);
    const p = parse(signupParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    await loadRaid(p.id, p.raidId);
    const [row] = await db.delete(raidSignups).where(and(eq(raidSignups.id, p.signupId), eq(raidSignups.raidId, p.raidId))).returning({ id: raidSignups.id });
    if (!row) throw notFound("Inscription introuvable.");
    await touchRaid(db, p.raidId);
    return { ok: true };
  });

  app.delete("/:id/raids/:raidId", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    await db.delete(raids).where(eq(raids.id, r.id));
    // L'annonce Discord éventuelle sera supprimée par le bot
    if (r.discordChannelId && r.discordMessageId) await db.insert(discordDeletions).values({ channelId: r.discordChannelId, messageId: r.discordMessageId });
    await audit(db, req, "raid_deleted", { userId: u.id, groupId: p.id, meta: { raidId: r.id, name: r.name } });
    bus.group({ t: "raids", g: p.id });
    return { ok: true };
  });
}
