import { and, asc, eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { characters, groupCharacters } from "../db/schema";

/**
 * Persos d'un joueur dans un groupe. Règle tenue ici : un joueur qui a au moins un perso dans le groupe y a
 * exactement un main (son premier perso ajouté, ou celui qu'il choisit ; un autre le remplace s'il est retiré).
 */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;

/** Ajoute un perso au groupe (sans effet s'il y est déjà) ; il devient main si le joueur n'en a pas. */
export async function assignCharacter(db: Tx, groupId: string, characterId: string, userId: string, main = false) {
  const [hasMain] = await db.select({ id: groupCharacters.characterId }).from(groupCharacters)
    .where(and(eq(groupCharacters.groupId, groupId), eq(groupCharacters.userId, userId), eq(groupCharacters.isMain, true)));
  await db.insert(groupCharacters).values({ groupId, characterId, userId, isMain: !hasMain && !main })
    .onConflictDoNothing();
  if (main) await setMain(db, groupId, characterId, userId);
}

/** Fait de ce perso (déjà dans le groupe) le main du joueur. */
export async function setMain(db: Tx, groupId: string, characterId: string, userId: string) {
  await db.update(groupCharacters).set({ isMain: false })
    .where(and(eq(groupCharacters.groupId, groupId), eq(groupCharacters.userId, userId), eq(groupCharacters.isMain, true)));
  await db.update(groupCharacters).set({ isMain: true })
    .where(and(eq(groupCharacters.groupId, groupId), eq(groupCharacters.characterId, characterId)));
}

/** Retire un perso du groupe ; si c'était le main, le premier perso restant (ordre de « Mes persos ») le remplace. */
export async function unassignCharacter(db: Tx, groupId: string, characterId: string, userId: string) {
  const [gone] = await db.delete(groupCharacters)
    .where(and(eq(groupCharacters.groupId, groupId), eq(groupCharacters.characterId, characterId))).returning();
  if (gone?.isMain) await promoteMain(db, groupId, userId);
}

/** Le joueur n'a plus de main dans ce groupe (main retiré ou supprimé) : son premier perso restant le devient. */
export async function promoteMain(db: Tx, groupId: string, userId: string) {
  const [next] = await db.select({ id: groupCharacters.characterId }).from(groupCharacters)
    .innerJoin(characters, eq(characters.id, groupCharacters.characterId))
    .where(and(eq(groupCharacters.groupId, groupId), eq(groupCharacters.userId, userId)))
    .orderBy(asc(characters.sortOrder), asc(characters.createdAt)).limit(1);
  if (next) await setMain(db, groupId, next.id, userId);
}

/** Jointure « perso dans ce groupe » pour les requêtes sur les persos d'un groupe. */
export const inGroup = (groupId: string) =>
  and(eq(groupCharacters.characterId, characters.id), eq(groupCharacters.groupId, groupId));

