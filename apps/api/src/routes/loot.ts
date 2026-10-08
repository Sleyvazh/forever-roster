import { fullName, gameName, instanceKey, LOOT_COUNT_BY, LOOT_COUNT_MODES, LOOT_MODES, lootSettings, parseLootHistory, RETAIL_NO_SOFTRES } from "@forever/game-data";
import { and, asc, count, desc, eq, gte, ilike } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characters, gameItems, groupCharacters, groups, lootCatalog, lootCorrections, lootExclusions, raidLogs, raids, softReserves, users } from "../db/schema";
import { audit } from "../lib/audit";
import { bus } from "../lib/events";
import { ensureInGroup } from "../lib/group-characters";
import { membership, requireRole } from "../lib/groups";
import { badRequest, forbidden, notFound, parse } from "../lib/http";
import { checkLootMode, groupLootSettings, softReserveView, srClosesAt } from "../lib/loot";
import { groupGame, nameIndex } from "../lib/log-names";
import { groupLootCounts, seasonStartDate } from "../lib/loot-count";
import { currentUser, requireAuth } from "../lib/session";
import { likeContains } from "./gamedata";

/** Butin (lot C2) : réglages du groupe, soft reserve d'un raid, objets proposables (catalogue appris + recherche). */

const gid = z.object({ id: z.uuid() });
const rid = gid.extend({ raidId: z.uuid() });
const settingsInput = z.object({
  srCount: z.int().min(1).max(5), srPlus: z.boolean(), srPlusStep: z.int().min(1).max(50),
  srCloseMinutes: z.int().min(0).max(24 * 60), mainsFirst: z.boolean(),
  // Lot I : compte des objets reçus
  countMode: z.enum(LOOT_COUNT_MODES), countRaids: z.int().min(1).max(50), countBy: z.enum(LOOT_COUNT_BY),
  seasonStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(d => !!seasonStartDate(d), "Date de début de saison invalide.").nullable(),
}).partial();

export async function lootRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/:id/loot-settings", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await membership(db, id, u.id);
    return { settings: await groupLootSettings(db, id) };
  });

  app.put("/:id/loot-settings", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const body = parse(settingsInput, req.body);
    const settings = lootSettings({ ...(await groupLootSettings(db, id)), ...body });
    await db.update(groups).set({ lootSettings: settings }).where(eq(groups.id, id));
    await audit(db, req, "group_loot_settings", { userId: u.id, groupId: id, meta: { ...body } });
    bus.group({ t: "group", g: id });
    return { settings };
  });

  /* ---------- Compte des objets reçus (lot I) : visible de tout le groupe, corrections par les officiers ---------- */

  app.get("/:id/loot-counts", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await membership(db, id, u.id);
    const { summary, rows } = await groupLootCounts(db, id);
    const corrections = await db.select({
      id: lootCorrections.id, characterId: lootCorrections.characterId, name: characters.name, userId: characters.userId,
      delta: lootCorrections.delta, note: lootCorrections.note, by: lootCorrections.createdByName, at: lootCorrections.createdAt,
    }).from(lootCorrections).innerJoin(characters, eq(characters.id, lootCorrections.characterId))
      .where(and(eq(lootCorrections.groupId, id), ...(summary.since ? [gte(lootCorrections.createdAt, summary.since)] : [])))
      .orderBy(desc(lootCorrections.createdAt)).limit(200);
    return { summary, rows, corrections };
  });

  /** Officiers : +n / −n sur le compte d'un perso du groupe, avec un motif (daté et signé). */
  app.post("/:id/loot-corrections", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const body = parse(z.object({
      characterId: z.uuid(), delta: z.int().min(-20).max(20).refine(n => n !== 0, "La correction ne peut pas être 0."),
      note: z.string().trim().min(2, "Indique le motif de la correction.").max(120),
    }), req.body);
    const [c] = await db.select({ id: groupCharacters.characterId }).from(groupCharacters)
      .where(and(eq(groupCharacters.groupId, id), eq(groupCharacters.characterId, body.characterId)));
    if (!c) throw badRequest("Ce perso ne joue pas dans ce groupe.");
    const [me] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, u.id));
    const [row] = await db.insert(lootCorrections).values({ groupId: id, characterId: c.id, delta: body.delta, note: body.note, createdBy: u.id, createdByName: me?.name ?? "?" }).returning({ id: lootCorrections.id });
    await audit(db, req, "loot_count_corrected", { userId: u.id, groupId: id, meta: { characterId: c.id, delta: body.delta } });
    bus.group({ t: "group", g: id });
    return reply.code(201).send({ correction: { id: row!.id } });
  });

  app.delete("/:id/loot-corrections/:correctionId", async (req) => {
    const u = currentUser(req);
    const p = parse(gid.extend({ correctionId: z.uuid() }), req.params);
    await requireRole(db, p.id, u.id, "officer");
    const gone = await db.delete(lootCorrections).where(and(eq(lootCorrections.id, p.correctionId), eq(lootCorrections.groupId, p.id))).returning({ id: lootCorrections.id });
    if (!gone.length) throw notFound("Correction introuvable.");
    await audit(db, req, "loot_count_corrected", { userId: u.id, groupId: p.id, meta: { removed: p.correctionId } });
    bus.group({ t: "group", g: p.id });
    return { ok: true };
  });

  /**
   * Officiers : historique de butin d'avant le site (liste collée, parseLootHistory). Chaque joueur reconnu parmi les
   * persos du groupe (nom, avec ou sans royaume) reçoit une correction « Historique <nom> : 3 BiS, 4 Spé 1 ». Une
   * liste recollée n'ajoute rien à un perso qui a déjà sa correction de ce nom. `apply: false` : aperçu seulement.
   */
  app.post("/:id/loot-history", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await requireRole(db, id, u.id, "officer");
    const body = parse(z.object({ text: z.string().max(30000), label: z.string().trim().max(40).optional(), apply: z.boolean().default(false) }), req.body);
    const h = parseLootHistory(body.text);
    if (!h.entries.length) throw badRequest("Aucun joueur reconnu dans la liste : une ligne par joueur, « Nom - BiS 3, Spé 1 4 (total 7) », puis ses objets en « - objet ».");
    const label = (body.label || h.label || "").replace(/[;|\r\n]/g, " ").trim();
    const prefix = label ? `Historique ${label}` : "Historique";
    const game = await groupGame(db, id);
    const chars = await db.select({ id: characters.id, name: characters.name, realm: characters.realm, owner: users.displayName })
      .from(groupCharacters).innerJoin(characters, eq(characters.id, groupCharacters.characterId)).innerJoin(users, eq(users.id, groupCharacters.userId))
      .where(eq(groupCharacters.groupId, id));
    const find = nameIndex(game, chars);
    const done = new Set((await db.select({ characterId: lootCorrections.characterId, note: lootCorrections.note }).from(lootCorrections)
      .where(eq(lootCorrections.groupId, id))).filter(r => r.note.startsWith(`${prefix} :`)).map(r => r.characterId));
    type Row = { name: string; total: number; bis: number | null; ms: number | null; items: number; status: "new" | "exists" | "unknown" | "ambiguous" | "empty";
      character?: { id: string; name: string; owner: string }; candidates?: string[] };
    const rows: Row[] = [];
    const seen = new Set<string>();
    for (const e of h.entries) {
      const base = { name: e.name, total: e.total, bis: e.bis, ms: e.ms, items: e.items.length };
      const found = find(e.name);
      if (found.length > 1) { rows.push({ ...base, status: "ambiguous", candidates: found.map(c => game === "retail" ? fullName(c.name, c.realm) : c.name).sort() }); continue; }
      const c = found[0];
      if (!c) { rows.push({ ...base, status: "unknown" }); continue; }
      const character = { id: c.id, name: game === "retail" ? fullName(c.name, c.realm) : c.name, owner: c.owner };
      const status = e.total <= 0 ? "empty" : done.has(c.id) || seen.has(c.id) ? "exists" : "new";
      seen.add(c.id);
      rows.push({ ...base, status, character });
    }
    let created = 0;
    if (body.apply) {
      const [me] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, u.id));
      const values: (typeof lootCorrections.$inferInsert)[] = [];
      for (const r of rows) {
        if (r.status !== "new" || !r.character) continue;
        const note = `${prefix} : ${r.bis !== null && r.ms !== null ? `${r.bis} BiS, ${r.ms} Spé 1` : `${r.total} objet${r.total > 1 ? "s" : ""}`}`.slice(0, 120);
        // Une correction va de -20 à +20 : au-delà, en plusieurs
        for (let left = Math.min(r.total, 200); left > 0; left -= 20) {
          values.push({ groupId: id, characterId: r.character.id, delta: Math.min(20, left), note, createdBy: u.id, createdByName: me?.name ?? "?" });
        }
        r.status = "exists";
        created++;
      }
      if (values.length) {
        await db.insert(lootCorrections).values(values);
        await audit(db, req, "loot_history_imported", { userId: u.id, groupId: id, meta: { label: prefix, players: created } });
        bus.group({ t: "group", g: id });
      }
    }
    return reply.code(body.apply && created ? 201 : 200).send({ label: prefix, rows, created, ignored: h.ignored });
  });

  /** Officiers : sortir un objet du bilan du compte (ou l'y remettre). Repéré par objet, receveur et heure. */
  app.put("/:id/raids/:raidId/loot-exclusions", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const body = parse(z.object({ itemId: z.int().min(1), name: z.string().trim().min(1).max(64), at: z.int().min(0), excluded: z.boolean() }), req.body);
    const r = await loadRaid(p.id, p.raidId);
    const [log] = await db.select({ loot: raidLogs.loot }).from(raidLogs).where(eq(raidLogs.raidId, r.id));
    const recipient = gameName(body.name).toLowerCase();
    if (!log?.loot.some(l => l.itemId === body.itemId && l.at === body.at && gameName(l.name).toLowerCase() === recipient)) throw notFound("Objet introuvable dans le bilan de ce raid.");
    const k = and(eq(lootExclusions.raidId, r.id), eq(lootExclusions.itemId, body.itemId), eq(lootExclusions.recipient, recipient), eq(lootExclusions.at, body.at));
    if (body.excluded) {
      const [me] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, u.id));
      await db.insert(lootExclusions).values({ raidId: r.id, itemId: body.itemId, recipient, at: body.at, createdBy: u.id, createdByName: me?.name ?? "?" }).onConflictDoNothing();
    } else {
      await db.delete(lootExclusions).where(k);
    }
    await audit(db, req, "loot_count_corrected", { userId: u.id, groupId: p.id, meta: { raidId: r.id, itemId: body.itemId, excluded: body.excluded } });
    bus.group({ t: "raid", g: p.id, r: r.id });
    return { excluded: body.excluded };
  });

  async function loadRaid(groupId: string, raidId: string) {
    const [r] = await db.select().from(raids).where(and(eq(raids.id, raidId), eq(raids.groupId, groupId)));
    if (!r) throw notFound("Raid introuvable.");
    return r;
  }

  /** Officiers : changer le mode de butin d'un raid (ou la visibilité des réservations). Les réservations restent. */
  app.patch("/:id/raids/:raidId/loot", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    await requireRole(db, p.id, u.id, "officer");
    const body = parse(z.object({ lootMode: z.enum(LOOT_MODES).optional(), srHidden: z.boolean().optional() }), req.body);
    const r = await loadRaid(p.id, p.raidId);
    // Roster : journal ou conseil seulement (lot R3b)
    checkLootMode(await groupGame(db, p.id), body.lootMode, r.lootMode);
    await db.update(raids).set({ ...(body.lootMode && { lootMode: body.lootMode }), ...(body.srHidden !== undefined && { srHidden: body.srHidden }) }).where(eq(raids.id, r.id));
    bus.group({ t: "raid", g: p.id, r: r.id });
    return { lootMode: body.lootMode ?? r.lootMode, srHidden: body.srHidden ?? r.srHidden };
  });

  app.get("/:id/raids/:raidId/soft-reserves", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    const role = await membership(db, p.id, u.id);
    const r = await loadRaid(p.id, p.raidId);
    return softReserveView(db, r, { id: u.id, officer: role !== "member" });
  });

  /** Réserver un objet avec un de mes persos (raid en soft reserve, réservations ouvertes, dans la limite du groupe). */
  app.put("/:id/raids/:raidId/soft-reserves", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    const role = await membership(db, p.id, u.id);
    const body = parse(z.object({ characterId: z.uuid(), itemId: z.int().min(1) }), req.body);
    const r = await loadRaid(p.id, p.raidId);
    if (await groupGame(db, p.id) === "retail") throw badRequest(RETAIL_NO_SOFTRES);
    if (r.lootMode !== "softres") throw badRequest("Ce raid n'est pas en soft reserve.");
    const s = await groupLootSettings(db, p.id);
    const closes = srClosesAt(r.scheduledAt, s);
    if (closes && closes.getTime() <= Date.now()) throw badRequest("Les réservations de ce raid sont fermées.");
    const [c] = await db.select({ id: characters.id, cls: characters.cls }).from(characters).where(and(eq(characters.id, body.characterId), eq(characters.userId, u.id)));
    if (!c) throw forbidden("Ce personnage n'est pas à toi.");
    const [item] = await db.select({ id: gameItems.id }).from(gameItems).where(eq(gameItems.id, body.itemId));
    if (!item) throw badRequest("Objet inconnu.");
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(softReserves).where(and(eq(softReserves.raidId, r.id), eq(softReserves.characterId, c.id)));
    if (n >= s.srCount) throw badRequest(`Déjà ${s.srCount} réservation${s.srCount > 1 ? "s" : ""} pour ce perso : retires-en une avant.`);
    // Réserver avec un perso le fait entrer dans le groupe, comme s'inscrire (refusé s'il est rangé dans un autre)
    await ensureInGroup(db, p.id, c.id, u.id);
    await db.insert(softReserves).values({ raidId: r.id, characterId: c.id, userId: u.id, itemId: item.id }).onConflictDoNothing();
    bus.group({ t: "raid", g: p.id, r: r.id });
    return softReserveView(db, r, { id: u.id, officer: role !== "member" });
  });

  /** Retirer une réservation : la sienne (tant que c'est ouvert), ou n'importe laquelle pour un officier. */
  app.delete("/:id/raids/:raidId/soft-reserves", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    const role = await membership(db, p.id, u.id);
    const q = parse(z.object({ characterId: z.uuid(), itemId: z.coerce.number().int().min(1) }), req.query);
    const r = await loadRaid(p.id, p.raidId);
    const [row] = await db.select().from(softReserves).where(and(eq(softReserves.raidId, r.id), eq(softReserves.characterId, q.characterId), eq(softReserves.itemId, q.itemId)));
    if (!row) throw notFound("Réservation introuvable.");
    const officer = role !== "member";
    if (row.userId !== u.id && !officer) throw forbidden("Ce n'est pas ta réservation.");
    const closes = srClosesAt(r.scheduledAt, await groupLootSettings(db, p.id));
    if (!officer && closes && closes.getTime() <= Date.now()) throw badRequest("Les réservations de ce raid sont fermées.");
    await db.delete(softReserves).where(and(eq(softReserves.raidId, r.id), eq(softReserves.characterId, q.characterId), eq(softReserves.itemId, q.itemId)));
    bus.group({ t: "raid", g: p.id, r: r.id });
    return softReserveView(db, r, { id: u.id, officer });
  });

  /**
   * Objets proposables pour un raid : ceux vus tomber dans cette instance (catalogue appris par les bilans de tous
   * les groupes, par boss), puis la recherche libre dans la base d'objets (rares et mieux).
   */
  app.get("/:id/raids/:raidId/loot-options", async (req) => {
    const u = currentUser(req);
    const p = parse(rid, req.params);
    await membership(db, p.id, u.id);
    const { q } = parse(z.object({ q: z.string().trim().max(60).optional() }), req.query);
    const r = await loadRaid(p.id, p.raidId);
    const catalog = await db.select({ id: gameItems.id, name: gameItems.name, quality: gameItems.quality, boss: lootCatalog.boss, seen: lootCatalog.seen })
      .from(lootCatalog).innerJoin(gameItems, eq(gameItems.id, lootCatalog.itemId))
      .where(and(eq(lootCatalog.instance, instanceKey(r.name)), ...(q ? [ilike(gameItems.name, likeContains(q))] : [])))
      .orderBy(asc(lootCatalog.boss), desc(lootCatalog.seen), asc(gameItems.name)).limit(200);
    const search = q && q.length >= 2 ? await db.select({ id: gameItems.id, name: gameItems.name, quality: gameItems.quality }).from(gameItems)
      .where(and(ilike(gameItems.name, likeContains(q)), gte(gameItems.quality, 3))).orderBy(desc(gameItems.quality), asc(gameItems.name)).limit(20) : [];
    const inCatalog = new Set(catalog.map(c => c.id));
    return { catalog, search: search.filter(s => !inCatalog.has(s.id)) };
  });
}
