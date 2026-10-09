import { ATTENDED, attendanceStatus, FULL_NAME_MAX, GEAR_SLOTS, gearStats, LOOT_METHODS, LOOT_RESPONSES, lootSkipReason, RETAIL_DIFFICULTIES, type AttendanceStatus, type Game, type SignupStatus } from "@forever/game-data";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client";
import { characters, gameItems, groupCharacters as gc, groupMembers, groups, lootCorrections, lootExclusions, raidLogs, raids, raidSignups, users, type Gear } from "../db/schema";
import { bus } from "../lib/events";
import { membership } from "../lib/groups";
import { learnLoot } from "../lib/loot";
import { exclusionKey, groupLootCounts, raidExclusions } from "../lib/loot-count";
import { sheetAbsences } from "./absences";
import { badRequest, forbidden, notFound, parse } from "../lib/http";
import { charKey, groupGame, logKey, nameIndex, sameLogName } from "../lib/log-names";
import { currentUser, requireAuth } from "../lib/session";

/** Présence comptée sur les derniers raids relevés du groupe. */
const RECENT_RAIDS = 8;

/** Nom relevé en jeu : prénom (Forever) ou « Prénom-Royaume » (Roster). */
const logName = z.string().trim().min(1).max(FULL_NAME_MAX);

export const logInput = z.object({
  raidId: z.uuid(),
  start: z.int().min(0), end: z.int().min(0),
  recorder: z.string().trim().max(FULL_NAME_MAX),
  attendees: z.array(z.object({ name: logName, first: z.int().min(0), last: z.int().min(0), samples: z.int().min(0).max(100000) })).max(80),
  loot: z.array(z.object({
    itemId: z.int().min(1), name: logName, at: z.int().min(0), boss: z.string().trim().max(60),
    method: z.enum(LOOT_METHODS).optional(), response: z.enum(LOOT_RESPONSES).optional(), detail: z.string().trim().max(60).optional(),
    /** Roster : nom de l'objet, s'il est donné par l'addon. */
    itemName: z.string().trim().min(1).max(80).optional(),
  })).max(200),
  /** Roster (lignes E du bilan RRB) : fin de chaque rencontre de boss. */
  encounters: z.array(z.object({ encounterId: z.int().min(0), boss: z.string().trim().max(60), at: z.int().min(0), killed: z.boolean() })).max(100).optional(),
  /** Roster : difficulté relevée en jeu. */
  difficulty: z.enum(RETAIL_DIFFICULTIES).optional(),
  /** Bilan v2 : instance réelle (sinon, le nom du raid sert pour le catalogue de butin). */
  instance: z.string().trim().max(60).optional(),
  /** Lot K1 : relevé par le chef de raid (addon 1.3). */
  lead: z.boolean().optional(),
  /** Lot G : appel aux consommables lancé en raid (quantités par joueur, null : pas de réponse). */
  consumableCall: z.object({
    at: z.int().min(0), by: z.string().trim().max(40),
    counts: z.array(z.object({ name: z.string().trim().min(1).max(40), items: z.record(z.string().regex(/^\d{1,7}$/), z.int().min(0).max(9999)).nullable() })).max(80),
  }).optional(),
});

export type RaidLogInput = z.infer<typeof logInput>;

type GroupChar = { id: string; name: string; realm: string; cls: string; userId: string; owner: string; gear: Gear };

/**
 * Persos joués dans le groupe, par nom en jeu : le prénom sur Forever (le relevé de l'addon ne connaît que lui),
 * « Prénom-Royaume » sur Roster (lib/log-names.ts).
 */
async function groupCharacters(db: Db, groupId: string) {
  const game = await groupGame(db, groupId);
  const rows: GroupChar[] = await db.select({ id: characters.id, name: characters.name, realm: characters.realm, cls: characters.cls, userId: characters.userId, owner: users.displayName, gear: characters.gear })
    .from(characters).innerJoin(gc, and(eq(gc.characterId, characters.id), eq(gc.groupId, groupId)))
    .innerJoin(users, eq(users.id, characters.userId));
  return { rows, find: nameIndex(game, rows), game };
}

/** Le perso qui porte ce nom ; s'il y en a plusieurs, celui inscrit au raid. */
function pick(find: (name: string) => GroupChar[], name: string, signedUp: Set<string>) {
  const list = find(name);
  return list.find(c => signedUp.has(c.id)) ?? list[0] ?? null;
}

/** Bilan d'un raid pour sa page : présence (avec les inscrits jamais vus) et butin. */
export async function raidLogView(db: Db, raid: { id: string; groupId: string; scheduledAt: Date | null }) {
  const [log] = await db.select().from(raidLogs).where(eq(raidLogs.raidId, raid.id));
  if (!log) return null;
  const { rows, find, game } = await groupCharacters(db, raid.groupId);
  const signups = await db.select({ characterId: raidSignups.characterId, status: raidSignups.status }).from(raidSignups).where(eq(raidSignups.raidId, raid.id));
  const signupOf = new Map(signups.filter(s => s.characterId).map(s => [s.characterId!, s.status]));
  const signedUp = new Set(signupOf.keys());
  const span = { start: Math.floor(log.startedAt.getTime() / 1000), end: Math.floor(log.endedAt.getTime() / 1000) };
  const ref = raid.scheduledAt ? Math.floor(raid.scheduledAt.getTime() / 1000) : null;

  const seen = new Set<string>();
  const attendance: { name: string; characterId: string | null; cls: string; owner: string | null; status: AttendanceStatus; first: number | null; last: number | null }[] = [];
  for (const a of log.attendees) {
    const c = pick(find, a.name, signedUp);
    if (c) seen.add(c.id);
    const status = attendanceStatus(a, span, ref, c ? signupOf.get(c.id) ?? null : null)!;
    attendance.push({ name: c?.name ?? a.name, characterId: c?.id ?? null, cls: c?.cls ?? "", owner: c?.owner ?? null, status, first: a.first, last: a.last });
  }
  for (const c of rows) {
    if (seen.has(c.id)) continue;
    const status = attendanceStatus(null, span, ref, signupOf.get(c.id) ?? null);
    if (status) attendance.push({ name: c.name, characterId: c.id, cls: c.cls, owner: c.owner, status, first: null, last: null });
  }
  const ORDER: AttendanceStatus[] = ["present", "late", "left", "bench", "absent"];
  attendance.sort((x, y) => ORDER.indexOf(x.status) - ORDER.indexOf(y.status) || x.name.localeCompare(y.name));

  // Roster : pas de base des objets de Retail (celle du site est celle de Forever) ; nom donné par l'addon, s'il l'est
  const ids = game === "retail" ? [] : [...new Set(log.loot.map(l => l.itemId))];
  const items = ids.length ? await db.select({ id: gameItems.id, name: gameItems.name, quality: gameItems.quality }).from(gameItems).where(inArray(gameItems.id, ids)) : [];
  const itemOf = new Map(items.map(i => [i.id, i]));
  const excluded = await raidExclusions(db, raid.id);
  const loot = log.loot.map(l => {
    const c = pick(find, l.name, signedUp);
    const it = itemOf.get(l.itemId);
    return {
      itemId: l.itemId, itemName: it?.name ?? l.itemName ?? `Objet ${l.itemId}`, quality: it?.quality ?? 4, boss: l.boss, at: l.at,
      method: l.method ?? null, response: l.response ?? null, detail: l.detail ?? "",
      name: c?.name ?? l.name, gameName: l.name, characterId: c?.id ?? null, cls: c?.cls ?? "",
      bis: !!c && Object.values(c.gear ?? {}).some(g => g?.bisId === l.itemId),
      // Lot I : compte des objets reçus (spé principale), sauf exclusion par un officier
      skip: lootSkipReason(l), excluded: excluded.has(exclusionKey(raid.id, l.itemId, l.name, l.at)),
    };
  });
  return { recorder: log.recorder, startedAt: log.startedAt, endedAt: log.endedAt, updatedAt: log.updatedAt, attendance, loot,
    // Roster : rencontres de boss (lignes E) et difficulté relevée en jeu
    encounters: log.encounters, difficulty: log.difficulty };
}

/**
 * Enregistre le bilan relevé par l'addon (remplace le précédent). Réservé aux officiers du groupe et au créateur du raid :
 * le relevé de n'importe quel joueur présent ressemblerait, mais un seul fait foi. Les objectifs BiS reçus sont cochés « obtenu ».
 * auto (Roster Companion) : un bilan qui n'est pas celui du chef de raid ne remplace pas celui du chef (kept).
 * game : jeu du site où le bilan est collé ; un bilan d'un raid de l'autre jeu est refusé.
 */
export async function saveRaidLog(db: Db, userId: string, body: RaidLogInput, opts: { auto?: boolean; game?: Game } = {}) {
  const [raid] = await db.select({ id: raids.id, groupId: raids.groupId, name: raids.name, createdBy: raids.createdBy, game: groups.game })
    .from(raids).innerJoin(groups, eq(groups.id, raids.groupId)).where(eq(raids.id, body.raidId));
  if (!raid) throw notFound("Raid introuvable (supprimé du site ?).");
  const role = await membership(db, raid.groupId, userId);
  if (role === "member" && raid.createdBy !== userId) throw forbidden("Seuls les officiers du groupe enregistrent le bilan d'un raid.");
  if (opts.game && raid.game !== opts.game) throw badRequest(raid.game === "retail" ? "Ce bilan est celui d'un raid de Roster (WoW Retail)." : "Ce bilan est celui d'un raid de Forever Roster.");
  if (body.end < body.start) throw badRequest("Heures du bilan incohérentes.");

  // Catalogue de butin appris (instance réelle, sinon le nom du raid) ; un nouveau collage ne recompte pas
  const [before] = await db.select({ loot: raidLogs.loot, lead: raidLogs.lead }).from(raidLogs).where(eq(raidLogs.raidId, raid.id));
  if (opts.auto && before?.lead && !body.lead) {
    return { status: "kept" as const, raid: { id: raid.id, groupId: raid.groupId, name: raid.name }, attendees: body.attendees.length, loot: body.loot.length, bis: 0, unknown: [] as string[] };
  }
  const values = {
    recordedBy: userId, recorder: body.recorder, startedAt: new Date(body.start * 1000), endedAt: new Date(body.end * 1000),
    attendees: body.attendees, loot: body.loot, lead: !!body.lead, updatedAt: new Date(),
    encounters: body.encounters ?? [], difficulty: body.difficulty ?? null,
    // Un bilan recollé sans appel garde l'appel déjà enregistré
    ...(body.consumableCall && { consumableCall: body.consumableCall }),
  };
  // Catalogue de butin (soft reserve de Forever, objets de la base de Forever) : pas pour Roster
  if (raid.game !== "retail") await learnLoot(db, body.instance || raid.name, body.loot, before?.loot ?? []);
  await db.insert(raidLogs).values({ raidId: raid.id, ...values }).onConflictDoUpdate({ target: raidLogs.raidId, set: values });

  // Objectifs BiS reçus pendant le raid : cochés « obtenu » sur la fiche du perso
  const { find } = await groupCharacters(db, raid.groupId);
  const signed = new Set((await db.select({ id: raidSignups.characterId }).from(raidSignups).where(eq(raidSignups.raidId, raid.id))).flatMap(s => (s.id ? [s.id] : [])));
  let bis = 0;
  const updated = new Map<string, Gear>();
  for (const l of body.loot) {
    const c = pick(find, l.name, signed);
    if (!c) continue;
    const gear = updated.get(c.id) ?? { ...c.gear };
    for (const [slot, g] of Object.entries(gear)) {
      if (g?.bisId === l.itemId && !g.got) { gear[slot] = { ...g, got: true }; bis++; updated.set(c.id, gear); }
    }
  }
  for (const [id, gear] of updated) await db.update(characters).set({ gear, updatedAt: new Date() }).where(eq(characters.id, id));
  const unknown = body.attendees.filter(a => !find(a.name).length).map(a => a.name);
  bus.group({ t: "raid", g: raid.groupId, r: raid.id });
  if (updated.size) bus.group({ t: "chars", g: raid.groupId });
  return { status: "saved" as const, raid: { id: raid.id, groupId: raid.groupId, name: raid.name }, attendees: body.attendees.length, loot: body.loot.length, bis, unknown };
}

export async function raidLogRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.post("/raid-logs", async (req) => {
    const u = currentUser(req);
    const r = await saveRaidLog(db, u.id, parse(logInput, req.body));
    return { raid: r.raid, attendees: r.attendees, loot: r.loot, bis: r.bis, unknown: r.unknown };
  });

  /** Présence et butin du groupe : les derniers raids relevés, et pour chaque perso ses statuts, son taux et ses objets. */
  app.get("/groups/:id/attendance", async (req) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.uuid() }), req.params);
    await membership(db, id, u.id);
    const logs = await db.select({ raidId: raidLogs.raidId, name: raids.name, scheduledAt: raids.scheduledAt, startedAt: raidLogs.startedAt, endedAt: raidLogs.endedAt, attendees: raidLogs.attendees, loot: raidLogs.loot })
      .from(raidLogs).innerJoin(raids, eq(raids.id, raidLogs.raidId)).where(eq(raids.groupId, id))
      .orderBy(desc(sql`coalesce(${raids.scheduledAt}, ${raidLogs.startedAt})`)).limit(50);
    const recent = logs.slice(0, RECENT_RAIDS);
    const { rows, game } = await groupCharacters(db, id);
    const signups = recent.length ? await db.select({ raidId: raidSignups.raidId, characterId: raidSignups.characterId, status: raidSignups.status })
      .from(raidSignups).where(inArray(raidSignups.raidId, recent.map(l => l.raidId))) : [];
    const signupOf = new Map(signups.filter(s => s.characterId).map(s => [`${s.raidId}:${s.characterId}`, s.status as SignupStatus]));

    const counts = await groupLootCounts(db, id);
    const countOf = new Map(counts.rows.map(r => [r.characterId, r]));
    // Roster : pas de base des objets de Retail (nom donné par l'addon, s'il l'est)
    const itemIds = game === "retail" ? [] : [...new Set(logs.flatMap(l => l.loot.map(x => x.itemId)))];
    const items = itemIds.length ? await db.select({ id: gameItems.id, name: gameItems.name, quality: gameItems.quality }).from(gameItems).where(inArray(gameItems.id, itemIds)) : [];
    const itemOf = new Map(items.map(i => [i.id, i]));

    const out = rows.filter(c => c.cls).map(c => {
      const cells = recent.map(l => {
        const a = l.attendees.find(x => sameLogName(game, x.name, c)) ?? null;
        const span = { start: Math.floor(l.startedAt.getTime() / 1000), end: Math.floor(l.endedAt.getTime() / 1000) };
        return attendanceStatus(a, span, l.scheduledAt ? Math.floor(l.scheduledAt.getTime() / 1000) : null, signupOf.get(`${l.raidId}:${c.id}`) ?? null);
      });
      const got = logs.flatMap(l => l.loot.filter(x => sameLogName(game, x.name, c)).map(x => ({ ...x, raidName: l.name }))).sort((a, b) => b.at - a.at);
      const last = got[0];
      const kept = countOf.get(c.id);
      return {
        id: c.id, name: c.name, cls: c.cls, owner: c.owner, userId: c.userId, cells,
        attended: cells.filter(s => s && ATTENDED.includes(s)).length,
        loot: got.length,
        counted: kept?.count ?? 0,
        // Détail du compte (BiS, Upgrade, jets MS), même période et même façon de compter
        detail: { bis: kept?.bis ?? 0, upgrade: kept?.upgrade ?? 0, ms: kept?.ms ?? 0 },
        lastItem: last ? { id: last.itemId, name: itemOf.get(last.itemId)?.name ?? last.itemName ?? `Objet ${last.itemId}`, quality: itemOf.get(last.itemId)?.quality ?? 4, raidName: last.raidName } : null,
      };
    }).filter(c => c.cells.some(s => s) || c.loot > 0 || c.counted !== 0)
      .sort((a, b) => b.attended - a.attended || a.name.localeCompare(b.name));

    return { raids: recent.map(l => ({ id: l.raidId, name: l.name, scheduledAt: l.scheduledAt ?? l.startedAt })), characters: out, count: counts.summary };
  });

  /**
   * Fiche d'un joueur dans le groupe (visible par tous les membres) : ses persos joués ici, sa présence sur les
   * derniers raids relevés (le meilleur statut de ses persos), son passage sur le banc et le butin reçu.
   */
  app.get("/groups/:id/members/:userId/sheet", async (req) => {
    const u = currentUser(req);
    const p = parse(z.object({ id: z.uuid(), userId: z.uuid() }), req.params);
    const myRole = await membership(db, p.id, u.id);
    const [m] = await db.select({ userId: users.id, displayName: users.displayName, avatarId: users.avatarId, discordId: users.discordId, role: groupMembers.role, joinedAt: groupMembers.joinedAt })
      .from(groupMembers).innerJoin(users, eq(users.id, groupMembers.userId))
      .where(and(eq(groupMembers.groupId, p.id), eq(groupMembers.userId, p.userId)));
    if (!m) throw notFound("Ce joueur n'est pas membre du groupe.");

    const mine = await db.select({ c: characters, isMain: gc.isMain }).from(characters)
      .innerJoin(gc, and(eq(gc.characterId, characters.id), eq(gc.groupId, p.id)))
      .where(eq(characters.userId, p.userId)).orderBy(desc(gc.isMain), asc(characters.sortOrder));
    const itemIds = [...new Set(mine.flatMap(r => GEAR_SLOTS.map(s => r.c.gear[s]?.curId).filter((v): v is number => !!v)))];
    const levels = itemIds.length ? new Map((await db.select({ id: gameItems.id, lvl: gameItems.itemLevel }).from(gameItems).where(inArray(gameItems.id, itemIds))).map(x => [x.id, x.lvl])) : new Map<number, number>();
    const game = await groupGame(db, p.id);
    const isMine = (name: string) => mine.some(r => sameLogName(game, name, r.c));

    const logs = await db.select({ raidId: raidLogs.raidId, name: raids.name, scheduledAt: raids.scheduledAt, startedAt: raidLogs.startedAt, endedAt: raidLogs.endedAt, attendees: raidLogs.attendees, loot: raidLogs.loot })
      .from(raidLogs).innerJoin(raids, eq(raids.id, raidLogs.raidId)).where(eq(raids.groupId, p.id))
      .orderBy(desc(sql`coalesce(${raids.scheduledAt}, ${raidLogs.startedAt})`)).limit(50);
    const recent = logs.slice(0, RECENT_RAIDS);
    const signups = recent.length ? await db.select({ raidId: raidSignups.raidId, status: raidSignups.status }).from(raidSignups)
      .where(and(inArray(raidSignups.raidId, recent.map(l => l.raidId)), eq(raidSignups.userId, p.userId))) : [];
    const signupOf = new Map(signups.map(s => [s.raidId, s.status as SignupStatus]));
    const RANK: AttendanceStatus[] = ["present", "late", "left", "bench", "absent"];
    const cells = recent.map(l => {
      const span = { start: Math.floor(l.startedAt.getTime() / 1000), end: Math.floor(l.endedAt.getTime() / 1000) };
      const ref = l.scheduledAt ? Math.floor(l.scheduledAt.getTime() / 1000) : null;
      const seen = l.attendees.filter(a => isMine(a.name))
        .map(a => attendanceStatus(a, span, ref, signupOf.get(l.raidId) ?? null)).filter((x): x is AttendanceStatus => !!x);
      const status = seen.length ? seen.sort((a, b) => RANK.indexOf(a) - RANK.indexOf(b))[0]! : attendanceStatus(null, span, ref, signupOf.get(l.raidId) ?? null);
      return { raidId: l.raidId, name: l.name, scheduledAt: l.scheduledAt ?? l.startedAt, status };
    });
    const got = logs.flatMap(l => l.loot.filter(x => isMine(x.name)).map(x => ({ ...x, raidName: l.name, raidId: l.raidId }))).sort((a, b) => b.at - a.at).slice(0, 12);
    const excl = got.length ? new Set((await db.select().from(lootExclusions).where(inArray(lootExclusions.raidId, [...new Set(got.map(g => g.raidId))])))
      .map(e => exclusionKey(e.raidId, e.itemId, e.recipient, e.at))) : new Set<string>();
    const counts = await groupLootCounts(db, p.id);
    const myCounts = counts.rows.filter(r => r.userId === p.userId);
    // Détail du compte du joueur : par joueur, la ligne de n'importe lequel de ses persos ; par perso, leur somme (comme player)
    const sum = (k: "bis" | "upgrade" | "ms") => (counts.summary.by === "player" ? myCounts[0]?.[k] ?? 0 : myCounts.reduce((n, r) => n + r[k], 0));
    const corrections = myCounts.length ? await db.select({ id: lootCorrections.id, characterId: lootCorrections.characterId, delta: lootCorrections.delta, kind: lootCorrections.kind, note: lootCorrections.note, by: lootCorrections.createdByName, at: lootCorrections.createdAt })
      .from(lootCorrections).where(and(eq(lootCorrections.groupId, p.id), inArray(lootCorrections.characterId, myCounts.map(r => r.characterId))))
      .orderBy(desc(lootCorrections.createdAt)).limit(30) : [];
    const items = got.length && game !== "retail" ? await db.select({ id: gameItems.id, name: gameItems.name, quality: gameItems.quality }).from(gameItems).where(inArray(gameItems.id, [...new Set(got.map(g => g.itemId))])) : [];
    const itemOf = new Map(items.map(i => [i.id, i]));
    const bisOf = new Set(mine.flatMap(r => Object.values(r.c.gear ?? {}).flatMap(g => (g?.bisId ? [`${charKey(game, r.c)}:${g.bisId}`] : []))));

    return {
      member: { userId: m.userId, displayName: m.displayName, avatarId: m.avatarId, role: m.role, joinedAt: m.joinedAt, discordLinked: !!m.discordId },
      characters: mine.map(r => ({ id: r.c.id, name: r.c.name, realm: r.c.realm, cls: r.c.cls, spec1: r.c.spec1, spec2: r.c.spec2, level: r.c.level, portraitId: r.c.portraitId, isMain: r.isMain,
        gearStats: gearStats(r.c.gear, GEAR_SLOTS, id => levels.get(id)) })),
      attendance: { raids: recent.length, cells, attended: cells.filter(c => c.status && ATTENDED.includes(c.status)).length, benched: cells.filter(c => c.status === "bench").length },
      // Absences déclarées à venir (lot F) : le motif selon le choix du joueur (officiers ou tout le groupe)
      absences: await sheetAbsences(db, p.userId, { id: u.id, officer: myRole !== "member" }),
      loot: got.map(g => ({ itemId: g.itemId, name: itemOf.get(g.itemId)?.name ?? g.itemName ?? `Objet ${g.itemId}`, quality: itemOf.get(g.itemId)?.quality ?? 4, character: g.name, boss: g.boss,
        raidName: g.raidName, raidId: g.raidId, at: g.at, bis: bisOf.has(`${logKey(game, g.name)}:${g.itemId}`),
        skip: lootSkipReason(g), excluded: excl.has(exclusionKey(g.raidId, g.itemId, g.name, g.at)) })),
      // Lot I : objets reçus sur la période du groupe (par joueur ou par perso), corrections des officiers
      lootCount: {
        ...counts.summary,
        player: myCounts[0]?.player ?? 0,
        detail: { bis: sum("bis"), upgrade: sum("upgrade"), ms: sum("ms") },
        characters: myCounts.map(r => ({ characterId: r.characterId, name: r.name, own: r.own })),
        corrections: corrections.map(c => ({ ...c, inPeriod: !counts.summary.since || c.at >= counts.summary.since })),
      },
    };
  });
}
