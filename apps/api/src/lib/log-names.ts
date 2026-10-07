import { fullName, fullNameKey, gameName, type Game } from "@forever/game-data";
import { eq } from "drizzle-orm";
import type { Db } from "../db/client";
import { groups } from "../db/schema";

/**
 * Rapprochement des noms relevés par l'addon (bilans de raid) avec les fiches du groupe.
 * Forever : le prénom seul (l'addon ne connaît que lui, le nom de famille est ignoré).
 * Roster (WoW Retail) : « Prénom-Royaume », comparé sans casse, accents, apostrophes, espaces ni tirets ;
 * un nom relevé sans royaume (ne devrait pas arriver) retombe sur le prénom.
 */
type Named = { name: string; realm?: string | null };

const firstKey = (name: string) => fullNameKey(gameName(name).split("-")[0] ?? "");

/** Clé d'un nom relevé par l'addon. */
export const logKey = (game: Game, name: string) => (game === "retail" ? fullNameKey(name) : gameName(name).toLowerCase());
/** Clé d'une fiche, à comparer à logKey. */
export const charKey = (game: Game, c: Named) => (game === "retail" ? fullNameKey(fullName(c.name, c.realm)) : gameName(c.name).toLowerCase());

/** Ce nom relevé désigne-t-il cette fiche ? */
export function sameLogName(game: Game, logName: string, c: Named) {
  if (game === "retail" && !logName.includes("-")) return firstKey(logName) === firstKey(c.name);
  return logKey(game, logName) === charKey(game, c);
}

/** Index des fiches par nom relevé : la ou les fiches qui portent ce nom. */
export function nameIndex<T extends Named>(game: Game, rows: T[]) {
  const full = new Map<string, T[]>(), first = new Map<string, T[]>();
  const push = (m: Map<string, T[]>, k: string, c: T) => m.set(k, [...(m.get(k) ?? []), c]);
  for (const c of rows) {
    push(full, charKey(game, c), c);
    if (game === "retail") push(first, firstKey(c.name), c);
  }
  return (logName: string): T[] =>
    (game === "retail" && !logName.includes("-") ? first.get(firstKey(logName)) : full.get(logKey(game, logName))) ?? [];
}

/** Jeu d'un groupe (Forever par défaut). */
export async function groupGame(db: Db, groupId: string): Promise<Game> {
  const [g] = await db.select({ game: groups.game }).from(groups).where(eq(groups.id, groupId));
  return g?.game ?? "forever";
}
