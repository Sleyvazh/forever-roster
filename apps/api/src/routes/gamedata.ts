import { CLASSES, GEAR_SLOTS, PROFESSION_SKILL_LINES, SLOT_INVENTORY_TYPES } from "@forever/game-data";
import { and, asc, desc, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client";
import { characterRecipes, characters, gameItems, gameRecipes, gameTalents, groupMembers, users } from "../db/schema";
import { gameDataStatus } from "../gamedata/store";
import { notFound, parse } from "../lib/http";
import { currentUser, requireAuth } from "../lib/session";
import { currentLines, professionOf } from "../lib/professions";

/** Échappe les jokers de LIKE : une recherche « 100% » ne doit pas devenir un motif. */
const escapeLike = (q: string) => q.replace(/[\\%_]/g, c => `\\${c}`);
export const likeContains = (q: string) => `%${escapeLike(q)}%`;

export const itemSummary = {
  id: gameItems.id, name: gameItems.name, quality: gameItems.quality, itemLevel: gameItems.itemLevel, reqLevel: gameItems.reqLevel,
  kind: gameItems.kind, inventoryType: gameItems.inventoryType, origin: gameItems.origin, details: gameItems.details,
  /** Fabriqué par au moins une recette de métier (l'infobulle affiche alors « Où l'obtenir »). */
  crafted: sql<boolean>`exists (select 1 from ${gameRecipes} where ${gameRecipes.createdItemId} = ${gameItems.id})`,
};
export type ItemSummary = {
  id: number; name: string; quality: number; itemLevel: number; reqLevel: number; kind: string; inventoryType: number;
  origin: "forever" | "era"; details: import("@forever/game-data").ItemDetails; crafted: boolean;
};

export async function itemsById(db: Db, ids: Iterable<number>): Promise<Record<number, ItemSummary>> {
  const list = [...new Set(ids)];
  if (!list.length) return {};
  const rows = await db.select(itemSummary).from(gameItems).where(inArray(gameItems.id, list));
  return Object.fromEntries(rows.map(r => [r.id, r]));
}

export async function gameDataRoutes(app: FastifyInstance) {
  const { db } = app.ctx;
  app.addHook("preHandler", requireAuth);

  app.get("/status", async () => gameDataStatus(db));

  app.get("/items", async (req, reply) => {
    const { q, slot, limit } = parse(z.object({
      q: z.string().trim().min(2).max(60),
      slot: z.enum(GEAR_SLOTS).optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }), req.query);
    const where = and(
      ilike(gameItems.name, likeContains(q)),
      slot ? inArray(gameItems.inventoryType, SLOT_INVENTORY_TYPES[slot]) : gt(gameItems.inventoryType, 0),
    );
    const items = await db.select(itemSummary).from(gameItems).where(where)
      .orderBy(desc(sql`lower(${gameItems.name}) LIKE ${`${escapeLike(q.toLowerCase())}%`}`), desc(gameItems.quality), desc(gameItems.itemLevel), asc(gameItems.name))
      .limit(limit);
    reply.header("Cache-Control", "private, max-age=300");
    return { items };
  });

  /** Plusieurs objets d'un coup (fiche d'équipement : jusqu'à 34 identifiants). */
  app.get("/items/batch", async (req, reply) => {
    const { ids } = parse(z.object({ ids: z.string().regex(/^\d{1,9}(,\d{1,9}){0,59}$/, "liste d'identifiants attendue") }), req.query);
    reply.header("Cache-Control", "private, max-age=600");
    return { items: await itemsById(db, ids.split(",").map(Number)) };
  });

  /**
   * « Où l'obtenir » : recettes qui fabriquent l'objet, patrons qui les enseignent, et persos qui les connaissent
   * parmi les membres des groupes du joueur (les mêmes qu'il voit déjà dans l'onglet Artisans) et ses propres persos.
   */
  app.get("/items/:id/sources", async (req, reply) => {
    const u = currentUser(req);
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const recipes = await db.select({
      spellId: gameRecipes.spellId, name: gameRecipes.name, skillLine: gameRecipes.skillLine, reqSkill: gameRecipes.reqSkill,
      taughtBy: gameRecipes.taughtBy, fromItem: gameRecipes.fromItem,
    }).from(gameRecipes).where(eq(gameRecipes.createdItemId, id)).orderBy(asc(gameRecipes.reqSkill)).limit(10);
    reply.header("Cache-Control", "private, no-cache");
    if (!recipes.length) return { crafted: [] };

    const myGroups = db.select({ g: groupMembers.groupId }).from(groupMembers).where(eq(groupMembers.userId, u.id));
    const people = db.selectDistinct({ userId: groupMembers.userId }).from(groupMembers).where(inArray(groupMembers.groupId, myGroups));
    const known = await db.select({
      spellId: characterRecipes.spellId, name: characters.name, owner: users.displayName, userId: characters.userId, professions: characters.professions,
    }).from(characterRecipes)
      .innerJoin(characters, eq(characters.id, characterRecipes.characterId))
      .innerJoin(users, eq(users.id, characters.userId))
      .where(and(
        inArray(characterRecipes.spellId, recipes.map(r => r.spellId)),
        eq(characterRecipes.status, "known"),
        or(eq(characters.userId, u.id), inArray(characters.userId, people)),
      ))
      .orderBy(asc(characters.name)).limit(200);
    const teach = await itemsById(db, recipes.flatMap(r => r.taughtBy));
    return {
      crafted: recipes.map(r => ({
        spellId: r.spellId, recipe: r.name, profession: professionOf(r.skillLine), reqSkill: r.reqSkill,
        patterns: r.taughtBy.flatMap(t => (teach[t] ? [{ id: t, name: teach[t]!.name, quality: teach[t]!.quality }] : [])),
        trainer: !r.fromItem && r.taughtBy.length === 0,
        crafters: known.filter(k => k.spellId === r.spellId && currentLines(k.professions).has(r.skillLine))
          .map(k => ({ name: k.name, owner: k.owner, mine: k.userId === u.id })),
      })),
    };
  });

  /** Arbres de talents de Forever d'une classe : positions, rangs max, sorts, flèches et textes. */
  app.get("/talents/:cls", async (req, reply) => {
    const { cls } = parse(z.object({ cls: z.enum(Object.keys(CLASSES) as [string, ...string[]]) }), req.params);
    const talents = await db.select({ id: gameTalents.id, tree: gameTalents.tree, tier: gameTalents.tier, col: gameTalents.col, linkIndex: gameTalents.linkIndex,
      maxRank: gameTalents.maxRank, name: gameTalents.name, icon: gameTalents.icon, prereq: gameTalents.prereq, description: gameTalents.description })
      .from(gameTalents).where(eq(gameTalents.cls, cls)).orderBy(asc(gameTalents.tree), asc(gameTalents.linkIndex));
    reply.header("Cache-Control", "private, max-age=3600");
    return { talents };
  });

  app.get("/items/:id", async (req) => {
    const { id } = parse(z.object({ id: z.coerce.number().int().positive() }), req.params);
    const [item] = await db.select(itemSummary).from(gameItems).where(eq(gameItems.id, id));
    if (!item) throw notFound("Objet introuvable.");
    return { item };
  });

  /** Toutes les recettes d'un métier, avec les objets créés, les composants et les patrons (liste de ~50 à 400 lignes). */
  app.get("/professions/:name/recipes", async (req, reply) => {
    const { name } = parse(z.object({ name: z.enum(Object.keys(PROFESSION_SKILL_LINES) as [string, ...string[]]) }), req.params);
    const recipes = await db.select().from(gameRecipes).where(eq(gameRecipes.skillLine, PROFESSION_SKILL_LINES[name]!))
      .orderBy(asc(gameRecipes.reqSkill), asc(gameRecipes.name));
    const ids = recipes.flatMap(r => [...(r.createdItemId ? [r.createdItemId] : []), ...r.reagents.map(x => x.id), ...r.taughtBy]);
    reply.header("Cache-Control", "private, max-age=600");
    return { recipes, items: await itemsById(db, ids) };
  });
}
