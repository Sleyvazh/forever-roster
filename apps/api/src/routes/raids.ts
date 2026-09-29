import { computeCoverage, GROUP_SIZE, RAID_GROUPS } from "@forever/game-data";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characters, groupMembers, raids, raidSignups, users, type RaidSlot } from "../db/schema";
import { listSignups, signupInput, signupSummary, signUpSiteUser, touchRaid } from "../lib/signups";
import { discordDeletions } from "../db/schema";
import { SIGNUP_STATUSES } from "@forever/game-data";
import { audit } from "../lib/audit";
import { membership, requireRole } from "../lib/groups";
import { badRequest, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { MAX_RAIDS_PER_GROUP } from "../lib/recurring";

const raidParams = z.object({ id: z.uuid(), raidId: z.uuid() });
const raidFields = z.object({
  name: z.string().trim().min(2).max(60),
  scheduledAt: z.iso.datetime({ offset: true }).nullable().optional(),
  description: z.string().trim().max(1000).optional(),
});
const slot = z.object({
  group: z.int().min(1).max(RAID_GROUPS), pos: z.int().min(1).max(GROUP_SIZE),
  characterId: z.uuid().optional(), signupId: z.uuid().optional(),
}).refine(s => !!s.characterId !== !!s.signupId, "Une place contient un perso ou un inscrit sans compte.");
const slotKey = (s: RaidSlot) => (s.characterId ? `c:${s.characterId}` : `s:${s.signupId}`);

export async function raidRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  async function loadRaid(groupId: string, raidId: string) {
    const [r] = await db.select().from(raids).where(and(eq(raids.id, raidId), eq(raids.groupId, groupId)));
    if (!r) throw notFound("Raid introuvable.");
    return r;
  }

  async function slotCharacters(groupId: string, slots: RaidSlot[]) {
    const ids = slots.flatMap(s => (s.characterId ? [s.characterId] : []));
    if (!ids.length) return [];
    return db.select({ id: characters.id, name: characters.name, cls: characters.cls, spec1: characters.spec1, level: characters.level, race: characters.race, owner: users.displayName })
      .from(characters)
      .innerJoin(groupMembers, and(eq(groupMembers.userId, characters.userId), eq(groupMembers.groupId, groupId)))
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

  function withCoverage(slots: RaidSlot[], chars: Awaited<ReturnType<typeof slotCharacters>>, guests: Awaited<ReturnType<typeof slotGuests>>, specs = new Map<string, string>()) {
    const byId = new Map(chars.map(c => [c.id, c]));
    const guestById = new Map(guests.map(g => [g.id, g]));
    // Un perso dont le joueur a quitté le groupe, ou un inscrit sans compte désinscrit, disparaît de la composition.
    const live = slots.filter(s => (s.characterId ? byId.has(s.characterId) : guestById.has(s.signupId!)));
    const coverage = computeCoverage(live.map(s => {
      if (s.signupId) { const g = guestById.get(s.signupId)!; return { characterId: `s:${g.id}`, cls: g.cls, spec: g.spec || null, group: s.group }; }
      const c = byId.get(s.characterId!)!;
      return { characterId: c.id, cls: c.cls, spec: specs.get(c.id) || c.spec1 || null, group: s.group };
    }));
    return { slots: live, characters: chars, coverage: coverage.map(c => ({ id: c.effect.id, covered: c.covered, sources: c.sources, missingGroups: c.missingGroups })) };
  }

  app.get("/:id/raids", async (req) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await membership(db, id, u.id);
    const rows = await db.select({ id: raids.id, name: raids.name, scheduledAt: raids.scheduledAt, slots: raids.slots, updatedAt: raids.updatedAt, templateId: raids.templateId })
      .from(raids).where(eq(raids.groupId, id)).orderBy(desc(raids.scheduledAt), asc(raids.name));
    const summary = await signupSummary(db, rows.map(r => r.id), u.id);
    return { raids: rows.map(r => ({
      id: r.id, name: r.name, scheduledAt: r.scheduledAt, filled: r.slots.length, updatedAt: r.updatedAt, recurring: !!r.templateId,
      signups: summary.get(r.id)?.counts ?? {}, mySignup: summary.get(r.id)?.mine ?? null,
    })) };
  });

  app.post("/:id/raids", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await requireRole(db, id, u.id, "officer");
    const body = parse(raidFields, req.body);
    const existing = await db.select({ id: raids.id }).from(raids).where(eq(raids.groupId, id));
    if (existing.length >= MAX_RAIDS_PER_GROUP) throw badRequest(`Limite de ${MAX_RAIDS_PER_GROUP} raids atteinte.`);
    const [r] = await db.insert(raids).values({
      groupId: id, name: body.name, scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null, description: body.description ?? "", createdBy: u.id,
    }).returning();
    await audit(db, req, "raid_created", { userId: u.id, groupId: id, meta: { raidId: r!.id, name: body.name } });
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
      raid: { id: r.id, name: r.name, scheduledAt: r.scheduledAt, description: r.description, updatedAt: r.updatedAt, rosterPublished: !!r.rosterPublishedAt },
      canEdit: role !== "member", ...withCoverage(r.slots, chars, await slotGuests(r.id, r.slots), await signupSpecs(r.id)),
      signups: signups.map(x => ({ ...x, mine: x.userId === u.id })),
    };
  });

  app.put("/:id/raids/:raidId", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const current = await loadRaid(p.id, p.raidId);
    const body = parse(raidFields.extend({ slots: z.array(slot).max(RAID_GROUPS * GROUP_SIZE) }), req.body);

    const seatKeys = new Set(body.slots.map(s => `${s.group}:${s.pos}`));
    if (seatKeys.size !== body.slots.length) throw badRequest("Deux personnages occupent la même place.");
    if (new Set(body.slots.map(slotKey)).size !== body.slots.length) throw badRequest("Un personnage ne peut occuper qu'une place.");
    const chars = await slotCharacters(p.id, body.slots);
    if (chars.length !== body.slots.filter(s => s.characterId).length) throw badRequest("Certains personnages n'appartiennent pas à un membre du groupe.");
    const guests = await slotGuests(p.raidId, body.slots);
    if (guests.length !== body.slots.filter(s => s.signupId).length) throw badRequest("Certains inscrits sans compte ne sont pas inscrits à ce raid.");

    const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt) : null;
    const moved = (scheduledAt?.getTime() ?? null) !== (current.scheduledAt?.getTime() ?? null);
    await db.update(raids).set({
      name: body.name, scheduledAt, slots: body.slots, updatedAt: new Date(),
      // Nouvelle date : le rappel de la veille sera renvoyé
      ...(moved && { reminderSentAt: null }),
      ...(body.description !== undefined && { description: body.description }),
      discordChangedAt: new Date(),
    }).where(eq(raids.id, p.raidId));
    return withCoverage(body.slots, chars, guests, await signupSpecs(p.raidId));
  });

  /** Officiers : afficher (ou retirer) la composition dans l'annonce Discord. */
  app.post("/:id/raids/:raidId/roster", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    await db.update(raids).set({ rosterPublishedAt: new Date(), discordChangedAt: new Date() }).where(eq(raids.id, r.id));
    await audit(db, req, "raid_roster_published", { userId: u.id, groupId: p.id, meta: { raidId: r.id, name: r.name } });
    return { rosterPublished: true };
  });

  app.delete("/:id/raids/:raidId/roster", async (req) => {
    const u = currentUser(req);
    const p = parse(raidParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const r = await loadRaid(p.id, p.raidId);
    await db.update(raids).set({ rosterPublishedAt: null, discordChangedAt: new Date() }).where(eq(raids.id, r.id));
    await audit(db, req, "raid_roster_unpublished", { userId: u.id, groupId: p.id, meta: { raidId: r.id, name: r.name } });
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

  /** Officiers : changer le statut d'un inscrit (ex. le passer sur le banc) ou retirer une inscription. */
  const signupParams = raidParams.extend({ signupId: z.uuid() });
  app.patch("/:id/raids/:raidId/signups/:signupId", async (req) => {
    const u = currentUser(req);
    const p = parse(signupParams, req.params);
    await requireRole(db, p.id, u.id, "officer");
    await loadRaid(p.id, p.raidId);
    const { status } = parse(z.object({ status: z.enum(SIGNUP_STATUSES) }), req.body);
    const [row] = await db.update(raidSignups).set({ status, updatedAt: new Date() })
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
    return { ok: true };
  });
}
