import { instanceKey, LOOT_MODES, lootSettings } from "@forever/game-data";
import { and, asc, count, desc, eq, gte, ilike } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characters, gameItems, groups, lootCatalog, raids, softReserves } from "../db/schema";
import { audit } from "../lib/audit";
import { bus } from "../lib/events";
import { ensureInGroup } from "../lib/group-characters";
import { membership, requireRole } from "../lib/groups";
import { badRequest, forbidden, notFound, parse } from "../lib/http";
import { groupLootSettings, softReserveView, srClosesAt } from "../lib/loot";
import { currentUser, requireAuth } from "../lib/session";
import { likeContains } from "./gamedata";

/** Butin (lot C2) : réglages du groupe, soft reserve d'un raid, objets proposables (catalogue appris + recherche). */

const gid = z.object({ id: z.uuid() });
const rid = gid.extend({ raidId: z.uuid() });
const settingsInput = z.object({
  srCount: z.int().min(1).max(5), srPlus: z.boolean(), srPlusStep: z.int().min(1).max(50),
  srCloseMinutes: z.int().min(0).max(24 * 60), mainsFirst: z.boolean(),
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
