import { nameKey } from "./guild";

/**
 * Niveau des fiches relevé en jeu (Forever, 7/11) : une fiche du site rangée dans une guilde liée suit le niveau du perso
 * de la liste de guilde du jeu qu'on lui rapproche. Dans l'ordre :
 *  1. « addon » : la fiche porte le GUID du perso (en-tête FRC envoyé par l'addon du joueur) ;
 *  2. « full » : fiche sans GUID dont le nom est le nom complet du perso en jeu (« Necko Brisefer »), sans casse ni accents ;
 *  3. « first » : fiche sans GUID nommée d'un seul prénom (« Necko »), porté par un seul perso de la liste.
 * Jamais : un perso que l'addon de la fiche d'un autre joueur a déjà pris, un prénom porté par
 * deux persos, deux fiches de joueurs différents qui visent le même perso par leur nom (aucune des deux). Plusieurs fiches
 * d'un même joueur qui visent le même perso le suivent toutes (une fiche « leurre » ne libère pas l'autre). Une fiche
 * synchronisée par l'addon dont le GUID n'est pas dans la liste est un autre perso : pas de rapprochement par son nom.
 * Le prénom d'un perso de la liste est son premier mot (les noms du jeu n'ont pas de royaume accolé).
 */
export interface FicheToMatch { id: string; userId: string; name: string; guid: string | null }
export interface RosterToMatch { guid: string; name: string }
export type FicheMatchBy = "addon" | "full" | "first";
export interface FicheMatch { guid: string; by: FicheMatchBy }

/**
 * fiches : fiches rangées dans la guilde ; roster : persos actuels de la liste du jeu ; claimed : GUID → compte d'une fiche
 * (n'importe laquelle, rangée ou non) qui porte ce GUID. Rend fiche → perso.
 */
export function matchFiches(fiches: readonly FicheToMatch[], roster: readonly RosterToMatch[], claimed: ReadonlyMap<string, string>): Map<string, FicheMatch> {
  const byGuid = new Map(roster.map(m => [m.guid, m]));
  const out = new Map<string, FicheMatch>();
  /** Perso pris par l'addon d'une fiche rangée ici → compte de cette fiche. */
  const taken = new Map<string, string>();
  for (const f of fiches) {
    if (f.guid && byGuid.has(f.guid)) { out.set(f.id, { guid: f.guid, by: "addon" }); taken.set(f.guid, f.userId); }
  }
  const byFull = new Map<string, RosterToMatch[]>(), byFirst = new Map<string, RosterToMatch[]>();
  const push = (map: Map<string, RosterToMatch[]>, k: string, m: RosterToMatch) => { if (k) map.set(k, [...(map.get(k) ?? []), m]); };
  for (const m of roster) { const k = nameKey(m.name); push(byFull, k, m); push(byFirst, k.split(" ")[0] ?? "", m); }

  const byName = new Map<string, { id: string; userId: string; m: FicheMatch }[]>();
  for (const f of fiches) {
    if (f.guid || out.has(f.id)) continue;
    const k = nameKey(f.name);
    if (!k) continue;
    let hits: RosterToMatch[] | undefined, by: FicheMatchBy;
    if (byFull.has(k)) { hits = byFull.get(k); by = "full"; }
    else if (!k.includes(" ")) { hits = byFirst.get(k); by = "first"; }
    else continue;
    if (!hits || hits.length !== 1) continue;
    const m = hits[0]!;
    // Pris par l'addon d'une fiche d'un autre joueur : pas pour celle-ci ; d'une autre fiche du même joueur : elle le suit aussi
    const owner = taken.get(m.guid) ?? claimed.get(m.guid);
    if (owner && owner !== f.userId) continue;
    byName.set(m.guid, [...(byName.get(m.guid) ?? []), { id: f.id, userId: f.userId, m: { guid: m.guid, by: by! } }]);
  }
  for (const list of byName.values()) if (list.every(x => x.userId === list[0]!.userId)) for (const x of list) out.set(x.id, x.m);
  return out;
}

/**
 * Verrou du niveau d'une fiche, pour le site : « game », relevé en jeu (nom du perso dans la liste, son niveau, heure de la
 * liste) ; « officer », fixé par un officier de la guilde (son nom, quand). Absent : le joueur le change librement.
 */
export type FicheLevelLock =
  | { by: "game"; name: string; level: number; at: string | null }
  | { by: "officer"; name: string; userId: string; at: string | null };
