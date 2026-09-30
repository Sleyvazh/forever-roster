import { GEAR_SLOTS, PROFESSION_SKILL_LINES, SLOT_INVENTORY_TYPES } from "@forever/game-data";
import { and, asc, desc, eq, gt, ilike, inArray, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Db } from "../db/client";
import { gameItems, gameRecipes } from "../db/schema";
import { gameDataStatus } from "../gamedata/store";
import { notFound, parse } from "../lib/http";
import { requireAuth } from "../lib/session";

/** Échappe les jokers de LIKE : une recherche « 100% » ne doit pas devenir un motif. */
const escapeLike = (q: string) => q.replace(/[\\%_]/g, c => `\\${c}`);
export const likeContains = (q: string) => `%${escapeLike(q)}%`;

export const itemSummary = { id: gameItems.id, name: gameItems.name, quality: gameItems.quality, itemLevel: gameItems.itemLevel, reqLevel: gameItems.reqLevel, kind: gameItems.kind, inventoryType: gameItems.inventoryType, origin: gameItems.origin };
export type ItemSummary = { id: number; name: string; quality: number; itemLevel: number; reqLevel: number; kind: string; inventoryType: number; origin: "forever" | "era" };

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
