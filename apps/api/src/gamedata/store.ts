import { count, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { gameItems, gameMeta, gameRecipes } from "../db/schema";
import type { ItemRow, RecipeRow } from "./extract";

const chunk = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Remplace le contenu des tables du jeu en une seule transaction : l'application ne voit jamais une base à moitié importée. */
export async function storeGameData(db: Db, data: { items: ItemRow[]; recipes: RecipeRow[] }, build: string,
  extra: { eraBuild?: string | null; cacheBuild?: string | null; cacheItems?: number } = {}) {
  await db.transaction(async tx => {
    await tx.delete(gameItems);
    const rows = data.items.map(i => ({
      id: i.id, name: i.name, quality: i.quality, itemLevel: i.itemLevel, reqLevel: i.reqLevel, classId: i.classId, subclassId: i.subclassId,
      inventoryType: i.inventoryType, kind: i.kind, origin: i.origin, details: i.details ?? {},
    }));
    for (const part of chunk(rows, 1000)) await tx.insert(gameItems).values(part);
    await tx.delete(gameRecipes);
    for (const part of chunk(data.recipes, 1000)) await tx.insert(gameRecipes).values(part);
    const eraItems = data.items.filter(i => i.origin === "era").length;
    const meta = {
      build, importedAt: new Date().toISOString(), source: "wago.tools", eraBuild: extra.eraBuild ?? "", eraItems: String(eraItems),
      cacheBuild: extra.cacheBuild ?? "", cacheItems: String(extra.cacheItems ?? 0),
    };
    for (const [key, value] of Object.entries(meta)) {
      await tx.insert(gameMeta).values({ key, value }).onConflictDoUpdate({ target: gameMeta.key, set: { value: sql`excluded.value` } });
    }
  });
}

export async function gameDataStatus(db: Db) {
  const meta = Object.fromEntries((await db.select().from(gameMeta)).map(r => [r.key, r.value]));
  const [[items], [recipes]] = await Promise.all([db.select({ n: count() }).from(gameItems), db.select({ n: count() }).from(gameRecipes)]);
  return {
    build: meta.build ?? null, importedAt: meta.importedAt ?? null, items: items?.n ?? 0, recipes: recipes?.n ?? 0,
    eraBuild: meta.eraBuild || null, eraItems: Number(meta.eraItems ?? 0),
    cacheBuild: meta.cacheBuild || null, cacheItems: Number(meta.cacheItems ?? 0),
  };
}
