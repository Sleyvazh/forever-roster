import { and, asc, eq, ne } from "drizzle-orm";
import type { Db } from "../db/client";
import { characters, groupCharacters, groups } from "../db/schema";
import { bus } from "./events";
import { badRequest } from "./http";

/**
 * Persos d'un joueur dans un groupe. Règles tenues ici :
 *  - un perso est rangé dans un seul groupe (ou aucun) ;
 *  - un joueur qui a au moins un perso dans le groupe y a exactement un main (son premier perso ajouté, ou celui
 *    qu'il choisit ; un autre le remplace s'il est retiré).
 */

type Tx = Pick<Db, "select" | "insert" | "update" | "delete">;

/**
 * Range un perso dans le groupe (sans effet s'il y est déjà) ; il devient main si le joueur n'en a pas.
 * S'il était dans un autre groupe, il le quitte (ses inscriptions aux raids restent).
 */
export async function assignCharacter(db: Tx, groupId: string, characterId: string, userId: string, main = false) {
  // Un site, deux adresses : un perso ne rejoint qu'un groupe de son jeu (Forever ou Retail)
  const [c] = await db.select({ game: characters.game }).from(characters).where(eq(characters.id, characterId));
  const [g] = await db.select({ game: groups.game }).from(groups).where(eq(groups.id, groupId));
  if (c && g && c.game !== g.game) throw badRequest("Ce perso n'est pas du même jeu que ce groupe.");
  const [other] = await db.select().from(groupCharacters)
    .where(and(eq(groupCharacters.characterId, characterId), ne(groupCharacters.groupId, groupId)));
  if (other) {
    await unassignCharacter(db, other.groupId, characterId, userId);
    bus.group({ t: "chars", g: other.groupId });
  }
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

/**
 * Perso choisi pour une inscription ou une réservation dans ce groupe : rangé dans le groupe s'il n'en a aucun,
 * refusé s'il est rangé dans un autre (le joueur le déplace lui-même dans Mes persos).
 */
export async function ensureInGroup(db: Tx, groupId: string, characterId: string, userId: string) {
  const [row] = await db.select({ groupId: groupCharacters.groupId, groupName: groups.name, name: characters.name }).from(groupCharacters)
    .innerJoin(groups, eq(groups.id, groupCharacters.groupId)).innerJoin(characters, eq(characters.id, groupCharacters.characterId))
    .where(eq(groupCharacters.characterId, characterId));
  if (row && row.groupId !== groupId) throw badRequest(`${row.name} est rangé dans « ${row.groupName} ». Change son groupe dans Mes persos, ou choisis un autre perso.`);
  if (!row) {
    await assignCharacter(db, groupId, characterId, userId);
    return true;
  }
  return false;
}

/** Jointure « perso dans ce groupe » pour les requêtes sur les persos d'un groupe. */
export const inGroup = (groupId: string) =>
  and(eq(groupCharacters.characterId, characters.id), eq(groupCharacters.groupId, groupId));

