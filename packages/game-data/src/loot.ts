import type { Game } from "./site";

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

/**
 * Roster (WoW Retail, lot R3b) : pas de soft reserve (choix de Flo, 07/10). Le butin est seulement noté (journal) ou
 * distribué par l'addon Roster (conseil) : le chef de butin reçoit les objets, puis conseil, jets MS / OS ou jet libre.
 */
export const RETAIL_LOOT_MODES = ["journal", "council"] as const satisfies readonly LootMode[];
export type RetailLootMode = (typeof RETAIL_LOOT_MODES)[number];
const RETAIL_LOOT_MODE_LABEL: Record<RetailLootMode, string> = { journal: "Journal", council: "Conseil (distribution par Roster)" };
const RETAIL_LOOT_MODE_HINT: Record<RetailLootMode, string> = {
  journal: "L'addon Roster note seulement qui reçoit quoi (butin de groupe du jeu).",
  council: "Le chef de butin reçoit les objets grâce à l'addon Roster et les distribue : conseil (réponses BiS, Upgrade… et votes), jets MS / OS ou jet libre ; l'échange se fait en jeu.",
};
/** Modes de butin proposés selon le jeu du site. */
export const lootModesOf = (game: Game): readonly LootMode[] => (game === "retail" ? RETAIL_LOOT_MODES : LOOT_MODES);
/** Mode tel que Roster le connaît : une ancienne soft reserve (impossible sur Roster) est lue comme un journal. */
export const retailLootMode = (mode: LootMode | string | null | undefined): RetailLootMode => (mode === "council" ? "council" : "journal");
/** Libellé d'un mode ; `short` : en étiquette (« Conseil » sur Roster). */
export function lootModeLabel(mode: LootMode, game: Game, short = false): string {
  if (game !== "retail") return LOOT_MODE_LABEL[mode];
  const m = retailLootMode(mode);
  return short && m === "council" ? "Conseil" : RETAIL_LOOT_MODE_LABEL[m];
}
export const lootModeHint = (mode: LootMode, game: Game) => (game === "retail" ? RETAIL_LOOT_MODE_HINT[retailLootMode(mode)] : LOOT_MODE_HINT[mode]);
/** Message de l'API quand on demande la soft reserve pour un raid de Roster. */
export const RETAIL_NO_SOFTRES = "Pas de soft reserve sur Roster : choisis « Journal » ou « Conseil (distribution par Roster) ».";

/** Réponse d'un joueur à un objet proposé au loot council (lot C2b, en jeu). */
export const LOOT_RESPONSES = ["bis", "upgrade", "off", "transmo"] as const;
export type LootResponse = (typeof LOOT_RESPONSES)[number];
export const LOOT_RESPONSE_LABEL: Record<LootResponse, string> = { bis: "BiS", upgrade: "Upgrade", off: "Off-Spec", transmo: "Transmo" };

/** Façon dont un objet a été attribué (bilan du raid). */
export const LOOT_METHODS = ["council", "sr", "roll", "ml"] as const;
export type LootMethod = (typeof LOOT_METHODS)[number];
export const LOOT_METHOD_LABEL: Record<LootMethod, string> = { council: "conseil", sr: "soft reserve", roll: "jet libre", ml: "maître du butin" };

/**
 * Roster (lot R3b) : comment un objet a été distribué, pour le bilan : « Conseil : BiS · 3 votes », « Jet MS 87 »,
 * « Jet OS 54 », « Jet libre 54 », « Chef de butin ». Null pour un objet seulement noté (butin de groupe du jeu).
 */
export function retailLootHow(l: { method?: LootMethod | null; response?: LootResponse | null; detail?: string | null }): string | null {
  const d = (l.detail ?? "").trim();
  switch (l.method) {
    case "council": return `Conseil${l.response ? ` : ${LOOT_RESPONSE_LABEL[l.response]}` : ""}${d ? ` · ${d}` : ""}`;
    case "roll": {
      if (/^(MS|OS)\b/i.test(d)) return `Jet ${d}`;
      const free = d.match(/^jet\b\s*(.*)$/i);
      return free ? `Jet libre${free[1] ? ` ${free[1]}` : ""}` : `Jet${d ? ` · ${d}` : ""}`;
    }
    case "ml": return /^gardé/i.test(d) ? "Gardé par le chef de butin" : `Chef de butin${d ? ` · ${d}` : ""}`;
    case "sr": return `Soft reserve${d ? ` · ${d}` : ""}`;
    default: return null;
  }
}

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
  /**
   * Compte des objets reçus (montré au conseil et dans Présence) : depuis le début de la saison, sur les 30 derniers
   * jours ou sur les X derniers raids relevés du groupe ; par joueur (main et alts ensemble) ou par perso.
   */
  countMode: LootCountMode;
  /** Début de la saison (AAAA-MM-JJ, heure de Paris) ; vide : tout l'historique. */
  seasonStart: string | null;
  /** Nombre de raids pour « X derniers raids ». */
  countRaids: number;
  countBy: LootCountBy;
}
export const LOOT_COUNT_MODES = ["season", "days", "raids"] as const;
export type LootCountMode = (typeof LOOT_COUNT_MODES)[number];
export const LOOT_COUNT_BY = ["player", "character"] as const;
export type LootCountBy = (typeof LOOT_COUNT_BY)[number];
/** Fenêtre glissante du mode « days ». */
export const LOOT_COUNT_DAYS = 30;
export const DEFAULT_LOOT_SETTINGS: LootSettings = {
  srCount: 2, srPlus: true, srPlusStep: 10, srCloseMinutes: 60, mainsFirst: true,
  countMode: "season", seasonStart: null, countRaids: 5, countBy: "player",
};

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

/**
 * Un objet reçu compte-t-il dans le total (spé principale) ? Oui : soft reserve, jet MS, conseil BiS ou Upgrade,
 * et tout objet dont on ne sait pas comment il a été donné (journal, maître du butin : les officiers peuvent l'exclure).
 * Non : jet OS, jet libre, conseil Off-Spec ou Transmo.
 */
export function lootCounts(l: { method?: LootMethod | null; response?: LootResponse | null; detail?: string | null }): boolean {
  return lootSkipReason(l) === null;
}
/** Raison pour laquelle un objet ne compte pas d'office (null : il compte). */
export function lootSkipReason(l: { method?: LootMethod | null; response?: LootResponse | null; detail?: string | null }): string | null {
  if (l.method === "council" && (l.response === "off" || l.response === "transmo")) return LOOT_RESPONSE_LABEL[l.response];
  if (l.method === "roll") {
    const d = (l.detail ?? "").trim();
    if (/^OS\b/i.test(d)) return "jet OS";
    if (/^jet\b/i.test(d)) return "jet libre";
  }
  // Roster (R3b) : objet gardé par le chef de butin (désenchantement, banque de guilde)
  if (l.method === "ml" && /^gardé/i.test((l.detail ?? "").trim())) return "gardé";
  return null;
}

/**
 * Détail des objets reçus (retours du raid de test, choix de Flo : « BiS · Upgrade · Jets MS ») : conseil BiS, conseil
 * Upgrade, jet MS. Les autres objets qui comptent (chef de butin, objet seulement noté, soft reserve, conseil sans
 * réponse) sont dans le total seulement. Une correction du compte peut aussi avoir une de ces catégories.
 */
export const LOOT_CATEGORIES = ["bis", "upgrade", "ms"] as const;
export type LootCategory = (typeof LOOT_CATEGORIES)[number];
export const LOOT_CATEGORY_LABEL: Record<LootCategory, string> = { bis: "BiS", upgrade: "Upgrade", ms: "Jet MS" };
/** Libellés courts du détail : « 2 BiS · 3 Up · 1 MS ». */
export const LOOT_CATEGORY_SHORT: Record<LootCategory, string> = { bis: "BiS", upgrade: "Up", ms: "MS" };
export type LootCategoryCounts = Record<LootCategory, number>;

/** Catégorie d'un objet reçu ; null s'il ne compte pas (lootSkipReason) ou s'il compte sans catégorie. */
export function lootCategory(l: { method?: LootMethod | null; response?: LootResponse | null; detail?: string | null }): LootCategory | null {
  if (lootSkipReason(l) !== null) return null;
  if (l.method === "council") return l.response === "bis" ? "bis" : l.response === "upgrade" ? "upgrade" : null;
  if (l.method === "roll" && /^MS\b/i.test((l.detail ?? "").trim())) return "ms";
  return null;
}

/** Détail court « 2 BiS · 3 Up · 1 MS » (catégories à 0 omises) ; vide si tout est à 0. */
export function lootCategoryText(c: Partial<LootCategoryCounts>): string {
  return LOOT_CATEGORIES.filter(k => (c[k] ?? 0) !== 0).map(k => `${c[k]} ${LOOT_CATEGORY_SHORT[k]}`).join(" · ");
}

/** Libellé court de la période du compte : « saison », « 30 j », « 5 raids » (en-têtes de colonne, addon). */
export function lootCountShort(s: Pick<LootSettings, "countMode" | "countRaids">): string {
  return s.countMode === "days" ? `${LOOT_COUNT_DAYS} j` : s.countMode === "raids" ? `${s.countRaids} raids` : "saison";
}
/** Libellé complet : « depuis le 06/10/2026 », « sur les 30 derniers jours », « sur les 5 derniers raids ». */
export function lootCountLabel(s: Pick<LootSettings, "countMode" | "countRaids" | "seasonStart">): string {
  if (s.countMode === "days") return `sur les ${LOOT_COUNT_DAYS} derniers jours`;
  if (s.countMode === "raids") return s.countRaids > 1 ? `sur les ${s.countRaids} derniers raids` : "sur le dernier raid";
  if (!s.seasonStart) return "depuis le début";
  const [y, m, d] = s.seasonStart.split("-");
  return `depuis le ${d}/${m}/${y}`;
}

/**
 * Historique de butin d'avant le site (liste collée par un officier, Administration → Butin) : un joueur par bloc,
 * « Nom - BiS 3, Spé 1 4 (total 7) » puis ses objets en « - objet ». Une ligne de titre « … (Season 2) » donne le nom
 * de l'historique. Chaque joueur reconnu dans le groupe reçoit une correction du compte des objets reçus.
 */
export interface LootHistoryEntry { name: string; bis: number | null; ms: number | null; total: number; items: string[] }
export interface LootHistory { label: string | null; entries: LootHistoryEntry[]; ignored: string[] }
export const LOOT_HISTORY_MAX = 200;

const HISTORY_HEAD = /^(.+?)\s+[-–—:]\s+BiS\s+(\d+)\s*[,;]\s*Sp[ée]\s*1\s+(\d+)(?:\s*\(\s*total\s+(\d+)\s*\))?\s*$/i;
const HISTORY_TOTAL = /^(.+?)\s+[-–—:]\s+(?:total\s+)?(\d+)\s+(?:objets?|items?)\s*$/i;
const HISTORY_ITEM = /^[-•*·]\s*(.+)$/;
const HISTORY_TITLE = /\(([^()]{1,40})\)\s*$/;

export function parseLootHistory(text: string): LootHistory {
  const out: LootHistory = { label: null, entries: [], ignored: [] };
  let cur: LootHistoryEntry | null = null;
  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const item = HISTORY_ITEM.exec(line);
    if (item && cur) { if (cur.items.length < 100) cur.items.push(item[1]!.trim().slice(0, 120)); continue; }
    const head = HISTORY_HEAD.exec(line);
    const tot = head ? null : HISTORY_TOTAL.exec(line);
    if (head || tot) {
      const name = (head ?? tot)![1]!.trim().slice(0, 64);
      const bis = head ? Number(head[2]) : null, ms = head ? Number(head[3]) : null;
      const total = head ? (head[4] !== undefined ? Number(head[4]) : bis! + ms!) : Number(tot![2]);
      cur = { name, bis, ms, total, items: [] };
      if (out.entries.length < LOOT_HISTORY_MAX) out.entries.push(cur);
      continue;
    }
    // Titre (« Season loot count - 64 items (Season 2) ») : avant le premier joueur
    const title = !out.entries.length && !out.label ? HISTORY_TITLE.exec(line) : null;
    if (title) { out.label = title[1]!.trim(); continue; }
    if (out.ignored.length < 10) out.ignored.push(line.slice(0, 120));
  }
  return out;
}
