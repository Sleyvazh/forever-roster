import { PROFESSION_SKILL_LINES } from "@forever/game-data";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "../db/client";
import { characterRecipes, characters, gameRecipes } from "../db/schema";
import { currentLines } from "./professions";

export const MAX_RECIPES = 2000;

export const recipeImportInput = z.object({
  spellIds: z.array(z.int().positive()).max(MAX_RECIPES).default([]),
  itemIds: z.array(z.int().positive()).max(MAX_RECIPES).default([]),
  /** Métiers lus en jeu dans le même export (la fiche peut ne pas être encore enregistrée). */
  professions: z.array(z.enum(Object.keys(PROFESSION_SKILL_LINES) as [string, ...string[]])).max(12).default([]),
});

/**
 * Patrons connus envoyés par l'addon : identifiants de sort de fabrication, ou d'objet fabriqué (le jeu ne donne
 * parfois que lui). Ajoutés comme « connus » sans rien retirer ; un patron « recherché » devient « connu ».
 */
export async function importKnownRecipes(db: Db, ch: Pick<typeof characters.$inferSelect, "id" | "professions">, body: z.infer<typeof recipeImportInput>) {
  const bySpell = body.spellIds.length
    ? await db.select({ spellId: gameRecipes.spellId }).from(gameRecipes).where(inArray(gameRecipes.spellId, body.spellIds)) : [];
  const byItem = body.itemIds.length
    ? await db.select({ spellId: gameRecipes.spellId, skillLine: gameRecipes.skillLine, itemId: gameRecipes.createdItemId })
      .from(gameRecipes).where(inArray(gameRecipes.createdItemId, body.itemIds)) : [];
  // Un objet peut être fabriqué par plusieurs recettes : on garde celles des métiers du perso
  const lines = currentLines(ch.professions);
  for (const p of body.professions) lines.add(PROFESSION_SKILL_LINES[p]!);
  const spells = [...new Set([...bySpell.map(r => r.spellId), ...byItem.filter(r => lines.has(r.skillLine)).map(r => r.spellId)])].slice(0, MAX_RECIPES);
  if (spells.length) {
    await db.insert(characterRecipes).values(spells.map(spellId => ({ characterId: ch.id, spellId, status: "known" as const })))
      .onConflictDoUpdate({ target: [characterRecipes.characterId, characterRecipes.spellId], set: { status: "known", updatedAt: new Date() } });
  }
  // Inconnus : identifiants qui ne correspondent à aucune recette de la base (ou d'un autre métier)
  const foundItems = new Set(byItem.filter(r => lines.has(r.skillLine)).map(r => r.itemId));
  const unknown = body.spellIds.length - bySpell.length + body.itemIds.filter(i => !foundItems.has(i)).length;
  return { known: spells.length, unknown };
}

/**
 * Patrons marqués « recherché » (ou retirés) en jeu : l'addon donne l'objet patron, on retrouve la recette qu'il enseigne.
 * Un patron déjà connu reste connu ; seul un « recherché » est retiré.
 */
export async function setWantedPatterns(db: Db, characterId: string, addItems: number[], removeItems: number[]) {
  const items = [...new Set([...addItems, ...removeItems])];
  const taught = items.length
    ? await db.select({ spellId: gameRecipes.spellId, taughtBy: gameRecipes.taughtBy }).from(gameRecipes)
      .where(or(...items.map(i => sql`${gameRecipes.taughtBy} @> ${JSON.stringify([i])}::jsonb`)))
    : [];
  const spellsFor = (itemIds: number[]) => [...new Set(taught.filter(r => r.taughtBy.some(t => itemIds.includes(t))).map(r => r.spellId))];
  const add = spellsFor(addItems), remove = spellsFor(removeItems);
  const current = add.length || remove.length
    ? await db.select({ spellId: characterRecipes.spellId, status: characterRecipes.status }).from(characterRecipes)
      .where(and(eq(characterRecipes.characterId, characterId), inArray(characterRecipes.spellId, [...add, ...remove])))
    : [];
  const status = new Map(current.map(r => [r.spellId, r.status]));
  const toAdd = add.filter(s => !status.has(s));
  const toRemove = remove.filter(s => status.get(s) === "wanted");
  if (toAdd.length) await db.insert(characterRecipes).values(toAdd.map(spellId => ({ characterId, spellId, status: "wanted" as const }))).onConflictDoNothing();
  if (toRemove.length) await db.delete(characterRecipes).where(and(eq(characterRecipes.characterId, characterId), inArray(characterRecipes.spellId, toRemove)));
  const found = new Set(taught.flatMap(r => r.taughtBy));
  return { added: toAdd.length, removed: toRemove.length, unknown: items.filter(i => !found.has(i)).length };
}
