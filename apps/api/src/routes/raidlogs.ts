import { ATTENDED, attendanceStatus, gameName, LOOT_METHODS, LOOT_RESPONSES, type AttendanceStatus, type SignupStatus } from "@forever/game-data";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client";
import { characters, gameItems, groupCharacters as gc, raidLogs, raids, raidSignups, users, type Gear } from "../db/schema";
import { bus } from "../lib/events";
import { membership } from "../lib/groups";
import { learnLoot } from "../lib/loot";
import { badRequest, forbidden, notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";

/** Présence comptée sur les derniers raids relevés du groupe. */
const RECENT_RAIDS = 8;

const logInput = z.object({
  raidId: z.uuid(),
  start: z.int().min(0), end: z.int().min(0),
  recorder: z.string().trim().max(40),
  attendees: z.array(z.object({ name: z.string().trim().min(1).max(40), first: z.int().min(0), last: z.int().min(0), samples: z.int().min(0).max(100000) })).max(80),
  loot: z.array(z.object({
    itemId: z.int().min(1), name: z.string().trim().min(1).max(40), at: z.int().min(0), boss: z.string().trim().max(60),
    method: z.enum(LOOT_METHODS).optional(), response: z.enum(LOOT_RESPONSES).optional(), detail: z.string().trim().max(60).optional(),
  })).max(200),
  /** Bilan v2 : instance réelle (sinon, le nom du raid sert pour le catalogue de butin). */
  instance: z.string().trim().max(60).optional(),
});

type GroupChar = { id: string; name: string; cls: string; userId: string; owner: string; gear: Gear };
const key = (name: string) => gameName(name).toLowerCase();

/** Persos joués dans le groupe, par prénom en jeu (le relevé de l'addon ne connaît que lui). */
async function groupCharacters(db: Db, groupId: string) {
  const rows: GroupChar[] = await db.select({ id: characters.id, name: characters.name, cls: characters.cls, userId: characters.userId, owner: users.displayName, gear: characters.gear })
    .from(characters).innerJoin(gc, and(eq(gc.characterId, characters.id), eq(gc.groupId, groupId)))
    .innerJoin(users, eq(users.id, characters.userId));
  const byName = new Map<string, GroupChar[]>();
  for (const c of rows) byName.set(key(c.name), [...(byName.get(key(c.name)) ?? []), c]);
  return { rows, byName };
}

/** Le perso qui porte ce prénom ; s'il y en a plusieurs, celui inscrit au raid. */
function pick(byName: Map<string, GroupChar[]>, name: string, signedUp: Set<string>) {
  const list = byName.get(key(name)) ?? [];
  return list.find(c => signedUp.has(c.id)) ?? list[0] ?? null;
}

/** Bilan d'un raid pour sa page : présence (avec les inscrits jamais vus) et butin. */
export async function raidLogView(db: Db, raid: { id: string; groupId: string; scheduledAt: Date | null }) {
  const [log] = await db.select().from(raidLogs).where(eq(raidLogs.raidId, raid.id));
  if (!log) return null;
  const { rows, byName } = await groupCharacters(db, raid.groupId);
  const signups = await db.select({ characterId: raidSignups.characterId, status: raidSignups.status }).from(raidSignups).where(eq(raidSignups.raidId, raid.id));
  const signupOf = new Map(signups.filter(s => s.characterId).map(s => [s.characterId!, s.status]));
  const signedUp = new Set(signupOf.keys());
  const span = { start: Math.floor(log.startedAt.getTime() / 1000), end: Math.floor(log.endedAt.getTime() / 1000) };
  const ref = raid.scheduledAt ? Math.floor(raid.scheduledAt.getTime() / 1000) : null;

  const seen = new Set<string>();
  const attendance: { name: string; characterId: string | null; cls: string; owner: string | null; status: AttendanceStatus; first: number | null; last: number | null }[] = [];
  for (const a of log.attendees) {
    const c = pick(byName, a.name, signedUp);
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

  const ids = [...new Set(log.loot.map(l => l.itemId))];
  const items = ids.length ? await db.select({ id: gameItems.id, name: gameItems.name, quality: gameItems.quality }).from(gameItems).where(inArray(gameItems.id, ids)) : [];
  const itemOf = new Map(items.map(i => [i.id, i]));
  const loot = log.loot.map(l => {
    const c = pick(byName, l.name, signedUp);
    const it = itemOf.get(l.itemId);
    return {
      itemId: l.itemId, itemName: it?.name ?? `Objet ${l.itemId}`, quality: it?.quality ?? 4, boss: l.boss, at: l.at,
      method: l.method ?? null, response: l.response ?? null, detail: l.detail ?? "",
      name: c?.name ?? l.name, characterId: c?.id ?? null, cls: c?.cls ?? "",
      bis: !!c && Object.values(c.gear ?? {}).some(g => g?.bisId === l.itemId),
    };
  });
  return { recorder: log.recorder, startedAt: log.startedAt, endedAt: log.endedAt, updatedAt: log.updatedAt, attendance, loot };
}

export async function raidLogRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  /**
   * Enregistre le bilan relevé par l'addon (remplace le précédent). Réservé aux officiers du groupe et au créateur du raid :
   * le relevé de n'importe quel joueur présent ressemblerait, mais un seul fait foi. Les objectifs BiS reçus sont cochés « obtenu ».
   */
  app.post("/raid-logs", async (req) => {
    const u = currentUser(req);
    const body = parse(logInput, req.body);
    const [raid] = await db.select({ id: raids.id, groupId: raids.groupId, name: raids.name, createdBy: raids.createdBy }).from(raids).where(eq(raids.id, body.raidId));
    if (!raid) throw notFound("Raid introuvable (supprimé du site ?).");
    const role = await membership(db, raid.groupId, u.id);
    if (role === "member" && raid.createdBy !== u.id) throw forbidden("Seuls les officiers du groupe enregistrent le bilan d'un raid.");
    if (body.end < body.start) throw badRequest("Heures du bilan incohérentes.");

    const values = {
      recordedBy: u.id, recorder: body.recorder, startedAt: new Date(body.start * 1000), endedAt: new Date(body.end * 1000),
      attendees: body.attendees, loot: body.loot, updatedAt: new Date(),
    };
    // Catalogue de butin appris (instance réelle, sinon le nom du raid) ; un nouveau collage ne recompte pas
    const [before] = await db.select({ loot: raidLogs.loot }).from(raidLogs).where(eq(raidLogs.raidId, raid.id));
    await learnLoot(db, body.instance || raid.name, body.loot, before?.loot ?? []);
    await db.insert(raidLogs).values({ raidId: raid.id, ...values }).onConflictDoUpdate({ target: raidLogs.raidId, set: values });

    // Objectifs BiS reçus pendant le raid : cochés « obtenu » sur la fiche du perso
    const { byName } = await groupCharacters(db, raid.groupId);
    const signed = new Set((await db.select({ id: raidSignups.characterId }).from(raidSignups).where(eq(raidSignups.raidId, raid.id))).flatMap(s => (s.id ? [s.id] : [])));
    let bis = 0;
    const updated = new Map<string, Gear>();
    for (const l of body.loot) {
      const c = pick(byName, l.name, signed);
      if (!c) continue;
      const gear = updated.get(c.id) ?? { ...c.gear };
      for (const [slot, g] of Object.entries(gear)) {
        if (g?.bisId === l.itemId && !g.got) { gear[slot] = { ...g, got: true }; bis++; updated.set(c.id, gear); }
      }
    }
    for (const [id, gear] of updated) await db.update(characters).set({ gear, updatedAt: new Date() }).where(eq(characters.id, id));
    const unknown = body.attendees.filter(a => !byName.has(key(a.name))).map(a => a.name);
    bus.group({ t: "raid", g: raid.groupId, r: raid.id });
    if (updated.size) bus.group({ t: "chars", g: raid.groupId });
    return { raid: { id: raid.id, groupId: raid.groupId, name: raid.name }, attendees: body.attendees.length, loot: body.loot.length, bis, unknown };
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
    const { rows } = await groupCharacters(db, id);
    const signups = recent.length ? await db.select({ raidId: raidSignups.raidId, characterId: raidSignups.characterId, status: raidSignups.status })
      .from(raidSignups).where(inArray(raidSignups.raidId, recent.map(l => l.raidId))) : [];
    const signupOf = new Map(signups.filter(s => s.characterId).map(s => [`${s.raidId}:${s.characterId}`, s.status as SignupStatus]));

    const itemIds = [...new Set(logs.flatMap(l => l.loot.map(x => x.itemId)))];
    const items = itemIds.length ? await db.select({ id: gameItems.id, name: gameItems.name, quality: gameItems.quality }).from(gameItems).where(inArray(gameItems.id, itemIds)) : [];
    const itemOf = new Map(items.map(i => [i.id, i]));

    const out = rows.filter(c => c.cls).map(c => {
      const k = key(c.name);
      const cells = recent.map(l => {
        const a = l.attendees.find(x => key(x.name) === k) ?? null;
        const span = { start: Math.floor(l.startedAt.getTime() / 1000), end: Math.floor(l.endedAt.getTime() / 1000) };
        return attendanceStatus(a, span, l.scheduledAt ? Math.floor(l.scheduledAt.getTime() / 1000) : null, signupOf.get(`${l.raidId}:${c.id}`) ?? null);
      });
      const got = logs.flatMap(l => l.loot.filter(x => key(x.name) === k).map(x => ({ ...x, raidName: l.name }))).sort((a, b) => b.at - a.at);
      const last = got[0];
      return {
        id: c.id, name: c.name, cls: c.cls, owner: c.owner, cells,
        attended: cells.filter(s => s && ATTENDED.includes(s)).length,
        loot: got.length,
        lastItem: last ? { id: last.itemId, name: itemOf.get(last.itemId)?.name ?? `Objet ${last.itemId}`, quality: itemOf.get(last.itemId)?.quality ?? 4, raidName: last.raidName } : null,
      };
    }).filter(c => c.cells.some(s => s) || c.loot > 0)
      .sort((a, b) => b.attended - a.attended || a.name.localeCompare(b.name));

    return { raids: recent.map(l => ({ id: l.raidId, name: l.name, scheduledAt: l.scheduledAt ?? l.startedAt })), characters: out };
  });
}
