/**
 * Butin des raids (lot C2) : mode choisi à la création du raid, réglages du groupe, soft reserve et réponses
 * au loot council. Partagé par l'API, le site et l'export pour l'addon.
 */

export const LOOT_MODES = ["journal", "council", "softres"] as const;
export type LootMode = (typeof LOOT_MODES)[number];
export const LOOT_MODE_LABEL: Record<LootMode, string> = { journal: "Journal", council: "Loot council", softres: "Soft reserve" };
export const LOOT_MODE_HINT: Record<LootMode, string> = {
  journal: "On note seulement qui reçoit quoi (relevé de l'addon).",
  council: "Chacun dit s'il veut l'objet (BiS, Upgrade…), les officiers votent en jeu.",
  softres: "Chacun réserve des objets avant le raid ; les réservants les jouent aux dés.",
};

/** Réponse d'un joueur à un objet proposé au loot council (lot C2b, en jeu). */
export const LOOT_RESPONSES = ["bis", "upgrade", "off", "transmo"] as const;
export type LootResponse = (typeof LOOT_RESPONSES)[number];
export const LOOT_RESPONSE_LABEL: Record<LootResponse, string> = { bis: "BiS", upgrade: "Upgrade", off: "Off-Spec", transmo: "Transmo" };

/** Façon dont un objet a été attribué (bilan du raid). */
export const LOOT_METHODS = ["council", "sr", "roll", "ml"] as const;
export type LootMethod = (typeof LOOT_METHODS)[number];
export const LOOT_METHOD_LABEL: Record<LootMethod, string> = { council: "conseil", sr: "soft reserve", roll: "jet libre", ml: "maître du butin" };

/** Réglages du butin d'un groupe (Administration) ; le mode, lui, se choisit raid par raid. */
export interface LootSettings {
  /** Soft reserve : réservations par perso et par raid. */
  srCount: number;
  /** SR+ : bonus au jet quand on réserve le même objet raid après raid sans l'avoir reçu. */
  srPlus: boolean;
  srPlusStep: number;
  /** Fermeture des réservations, en minutes avant l'heure du raid. */
  srCloseMinutes: number;
  /** Les mains passent avant les alts (soft reserve et conseil). */
  mainsFirst: boolean;
}
export const DEFAULT_LOOT_SETTINGS: LootSettings = { srCount: 2, srPlus: true, srPlusStep: 10, srCloseMinutes: 60, mainsFirst: true };

export function lootSettings(raw: Partial<LootSettings> | null | undefined): LootSettings {
  return { ...DEFAULT_LOOT_SETTINGS, ...(raw ?? {}) };
}

/**
 * Bonus SR+ d'un perso pour un objet : nombre de raids précédents consécutifs (du plus récent au plus ancien)
 * où il avait réservé cet objet sans le recevoir, multiplié par le pas. Un raid sans réservation de cet objet,
 * ou où il l'a reçu, arrête le compte.
 */
export function srPlusBonus(history: { reserved: boolean; received: boolean }[], step: number): number {
  let n = 0;
  for (const h of history) {
    if (!h.reserved || h.received) break;
    n++;
  }
  return n * step;
}

/** Clé d'une instance pour le catalogue de butin : nom normalisé (« Molten Core », « molten core » → même clé). */
export const instanceKey = (name: string) => name.toLowerCase().replace(/\u0153/g, "oe").replace(/\u00e6/g, "ae").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
