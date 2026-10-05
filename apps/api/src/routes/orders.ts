import { and, asc, count, desc, eq, gt, ilike, inArray, ne, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { characters, craftOrders, discordDeletions, gameItems, gameRecipes, users } from "../db/schema";
import { bus } from "../lib/events";
import { membership } from "../lib/groups";
import { badRequest, forbidden, notFound, parse } from "../lib/http";
import { craftersOf, reagentsFor, touchOrder } from "../lib/orders";
import { currentUser, requireAuth } from "../lib/session";
import { likeContains } from "./gamedata";

/**
 * Commandes d'artisanat (lot F), onglet Artisans : un membre demande une fabrication, les artisans du groupe qui
 * connaissent le patron la voient, l'un d'eux la prend (« Je m'en charge »), puis la marque faite.
 * Ouverte → Prise → Faite. Une commande faite reste visible 14 jours.
 */

const gid = z.object({ id: z.uuid() });
const oid = gid.extend({ orderId: z.uuid() });
const MAX_OPEN_PER_USER = 10;
const KEEP_DONE_MS = 14 * 86400e3;

export async function orderRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  /** Recettes à commander : recherche dans toutes les recettes du jeu, avec qui les connaît dans le groupe. */
  app.get("/:id/orders/recipes", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const { q } = parse(z.object({ q: z.string().trim().min(2).max(60) }), req.query);
    await membership(db, id, u.id);
    const rows = await db.select({ spellId: gameRecipes.spellId, name: gameRecipes.name, skillLine: gameRecipes.skillLine, reqSkill: gameRecipes.reqSkill,
      itemId: gameRecipes.createdItemId, itemName: gameItems.name, quality: gameItems.quality, reagents: gameRecipes.reagents })
      .from(gameRecipes).leftJoin(gameItems, eq(gameItems.id, gameRecipes.createdItemId))
      .where(or(ilike(gameRecipes.name, likeContains(q)), ilike(gameItems.name, likeContains(q))))
      .orderBy(asc(gameRecipes.name)).limit(15);
    const who = await craftersOf(db, id, rows.map(r => r.spellId));
    // Composants (pour une fabrication) avec leur nom
    const rIds = [...new Set(rows.flatMap(r => r.reagents.map(x => x.id)))];
    const names = rIds.length ? new Map((await db.select({ id: gameItems.id, name: gameItems.name }).from(gameItems).where(inArray(gameItems.id, rIds))).map(i => [i.id, i.name])) : new Map<number, string>();
    // Ceux que le groupe sait faire d'abord
    return { recipes: rows.map(r => ({ ...r, reagents: r.reagents.map(x => ({ itemId: x.id, n: x.n, name: names.get(x.id) ?? `Objet ${x.id}` })), crafters: who.get(r.spellId) ?? [] }))
      .sort((a, b) => Number(!!b.crafters.length) - Number(!!a.crafters.length)) };
  });

  app.get("/:id/orders", async (req) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    const role = await membership(db, id, u.id);
    const req_ = users;
    const rows = await db.select({ o: craftOrders, requester: req_.displayName, quality: gameItems.quality, character: characters.name }).from(craftOrders)
      .innerJoin(req_, eq(req_.id, craftOrders.requesterId))
      .leftJoin(gameItems, eq(gameItems.id, craftOrders.itemId))
      .leftJoin(characters, eq(characters.id, craftOrders.characterId))
      .where(and(eq(craftOrders.groupId, id), or(ne(craftOrders.status, "done"), gt(craftOrders.doneAt, new Date(Date.now() - KEEP_DONE_MS)))))
      // Ouvertes, puis prises, puis faites ; les plus récentes d'abord
      .orderBy(sql`case ${craftOrders.status} when 'open' then 0 when 'taken' then 1 else 2 end`, desc(craftOrders.createdAt)).limit(100);
    const takers = rows.some(r => r.o.takerId)
      ? new Map((await db.select({ id: users.id, name: users.displayName }).from(users).where(inArray(users.id, rows.flatMap(r => (r.o.takerId ? [r.o.takerId] : []))))).map(x => [x.id, x.name]))
      : new Map<string, string>();
    const who = await craftersOf(db, id, [...new Set(rows.map(r => r.o.spellId))]);
    return {
      orders: rows.map(({ o, requester, quality, character }) => {
        const crafters = who.get(o.spellId) ?? [];
        return {
          id: o.id, spellId: o.spellId, recipeName: o.recipeName, item: o.itemId ? { id: o.itemId, name: o.itemName ?? o.recipeName, quality: quality ?? 1 } : null,
          quantity: o.quantity, reagents: o.reagents, note: o.note, status: o.status, createdAt: o.createdAt, takenAt: o.takenAt, doneAt: o.doneAt,
          requester: { id: o.requesterId, name: requester }, character, taker: o.takerId ? { id: o.takerId, name: takers.get(o.takerId) ?? "?" } : null,
          crafters, canCraft: crafters.some(c => c.userId === u.id),
          mine: o.requesterId === u.id, canManage: o.requesterId === u.id || role !== "member",
        };
      }),
    };
  });

  app.post("/:id/orders", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(gid, req.params);
    await membership(db, id, u.id);
    const body = parse(z.object({
      spellId: z.int().positive(), quantity: z.int().min(1).max(99).default(1), characterId: z.uuid().nullable().optional(), note: z.string().trim().max(300).default(""),
      /** Composants que le demandeur fournit (identifiants d'objets). */
      provided: z.array(z.int().positive()).max(20).default([]),
    }), req.body);
    const [r] = await db.select({ name: gameRecipes.name, itemId: gameRecipes.createdItemId, itemName: gameItems.name, reagents: gameRecipes.reagents }).from(gameRecipes)
      .leftJoin(gameItems, eq(gameItems.id, gameRecipes.createdItemId)).where(eq(gameRecipes.spellId, body.spellId));
    if (!r) throw badRequest("Recette inconnue.");
    if (body.characterId) {
      const [c] = await db.select({ id: characters.id }).from(characters).where(and(eq(characters.id, body.characterId), eq(characters.userId, u.id)));
      if (!c) throw badRequest("Ce personnage n'est pas à toi.");
    }
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(craftOrders)
      .where(and(eq(craftOrders.groupId, id), eq(craftOrders.requesterId, u.id), ne(craftOrders.status, "done")));
    if (n >= MAX_OPEN_PER_USER) throw badRequest(`Déjà ${MAX_OPEN_PER_USER} commandes en cours : attends qu'elles soient faites.`);
    const [o] = await db.insert(craftOrders).values({
      groupId: id, spellId: body.spellId, recipeName: r.name, itemId: r.itemId, itemName: r.itemName, quantity: body.quantity,
      requesterId: u.id, characterId: body.characterId ?? null, note: body.note, reagents: await reagentsFor(db, r.reagents, body.quantity, body.provided),
    }).returning({ id: craftOrders.id });
    bus.group({ t: "group", g: id });
    return reply.code(201).send({ order: { id: o!.id } });
  });

  /** Prendre (« Je m'en charge »), rendre, marquer faite, ou rouvrir. */
  app.patch("/:id/orders/:orderId", async (req) => {
    const u = currentUser(req);
    const p = parse(oid, req.params);
    const role = await membership(db, p.id, u.id);
    const { action, provided } = parse(z.object({ action: z.enum(["take", "release", "done", "reopen", "reagents"]), provided: z.array(z.int().positive()).max(20).optional() }), req.body);
    const [o] = await db.select().from(craftOrders).where(and(eq(craftOrders.id, p.orderId), eq(craftOrders.groupId, p.id)));
    if (!o) throw notFound("Commande introuvable.");
    const officer = role !== "member";
    const set = (() => {
      switch (action) {
        case "take":
          if (o.status !== "open") throw badRequest(o.status === "taken" ? "Quelqu'un s'en charge déjà." : "Cette commande est déjà faite.");
          return { status: "taken" as const, takerId: u.id, takenAt: new Date() };
        case "release":
          if (o.status !== "taken" || (o.takerId !== u.id && !officer)) throw forbidden("Seul l'artisan qui l'a prise peut la rendre.");
          return { status: "open" as const, takerId: null, takenAt: null };
        case "done":
          if (o.status === "done") throw badRequest("Cette commande est déjà faite.");
          if (o.takerId !== u.id && o.requesterId !== u.id && !officer) throw forbidden("Seuls l'artisan et le demandeur la marquent faite.");
          return { status: "done" as const, doneAt: new Date(), ...(!o.takerId && { takerId: u.id, takenAt: new Date() }) };
        case "reopen":
          if (o.requesterId !== u.id && !officer) throw forbidden("Seul le demandeur peut rouvrir sa commande.");
          return { status: "open" as const, takerId: null, takenAt: null, doneAt: null };
        case "reagents":
          // Composants fournis : cochés par le demandeur, l'artisan ou un officier
          if (o.requesterId !== u.id && o.takerId !== u.id && !officer) throw forbidden("Seuls le demandeur et l'artisan cochent les composants.");
          return { reagents: o.reagents.map(x => ({ ...x, provided: (provided ?? []).includes(x.itemId) })) };
      }
    })();
    await db.update(craftOrders).set({ ...set, ...touchOrder() }).where(eq(craftOrders.id, o.id));
    bus.group({ t: "group", g: p.id });
    return { ok: true };
  });

  /** Annuler (demandeur ou officier) ou archiver une commande faite. */
  app.delete("/:id/orders/:orderId", async (req) => {
    const u = currentUser(req);
    const p = parse(oid, req.params);
    const role = await membership(db, p.id, u.id);
    const [o] = await db.select().from(craftOrders).where(and(eq(craftOrders.id, p.orderId), eq(craftOrders.groupId, p.id)));
    if (!o) throw notFound("Commande introuvable.");
    if (o.requesterId !== u.id && role === "member" && !(o.status === "done" && o.takerId === u.id)) throw forbidden("Seul le demandeur (ou un officier) peut annuler cette commande.");
    await db.delete(craftOrders).where(eq(craftOrders.id, o.id));
    if (o.discordChannelId && o.discordMessageId) await db.insert(discordDeletions).values({ channelId: o.discordChannelId, messageId: o.discordMessageId });
    bus.group({ t: "group", g: p.id });
    return { ok: true };
  });
}
