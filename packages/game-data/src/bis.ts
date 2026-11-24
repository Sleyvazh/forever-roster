/**
 * Module BiS (lot BiS-1, 24/11/2026) : classement des objets par emplacement et proposition d'une BiS complète.
 *
 * Le moteur est générique : une spé = un profil (types d'armure et d'armes portés, poids des caractéristiques,
 * cap de toucher). Les poids sont exprimés dans des unités lisibles : par point pour les caractéristiques et la
 * puissance d'attaque, par 1 % pour le toucher et le critique (les objets de Forever donnent un pourcentage),
 * par point de DPS pour l'arme. Le toucher ne compte que jusqu'au cap ; au-delà, il ne vaut plus rien.
 *
 * Décisions de Flo (24/11) : poids par spé réglables (guilde, puis chaque joueur pour lui), import de poids
 * depuis les sites de simulation (chaîne Pawn) ; objets à effet (bijoux, reliques, armes à effet) classés à
 * part, sans ordre entre eux ; PvP et BoE affichés avec des filtres ; un objet est obtenable s'il a été vu en
 * jeu ou a une source connue, et pas marqué « non obtenable ».
 */
import { GEAR_SLOTS, SLOT_INVENTORY_TYPES, type ClassName, type Faction } from "./core";
import type { ItemDetails } from "./items";

export type GearSlot = (typeof GEAR_SLOTS)[number];

/* ---------- Caractéristiques et poids ---------- */

export const WEIGHT_KEYS = [
  "str", "agi", "sta", "int", "spi", "ap", "crit", "hit", "exp", "haste", "wdps", "armor", "def", "dodge", "parry", "sp", "heal", "mp5",
] as const;
export type WeightKey = (typeof WEIGHT_KEYS)[number];
export type Weights = Partial<Record<WeightKey, number>>;

/** Unité de chaque poids : « point », « % » ou « DPS ». */
export const WEIGHT_UNIT: Record<WeightKey, "point" | "%" | "DPS"> = {
  str: "point", agi: "point", sta: "point", int: "point", spi: "point", ap: "point", crit: "%", hit: "%", exp: "point",
  haste: "point", wdps: "DPS", armor: "point", def: "point", dodge: "point", parry: "point", sp: "point", heal: "point", mp5: "point",
};

/** Type de caractéristique du jeu → clé de poids (et diviseur pour passer en %, comme l'infobulle). */
const STAT_KEY: Record<number, [WeightKey, number]> = {
  3: ["agi", 1], 4: ["str", 1], 5: ["int", 1], 6: ["spi", 1], 7: ["sta", 1], 12: ["def", 1], 13: ["dodge", 1], 14: ["parry", 1],
  31: ["hit", 10], 32: ["crit", 14], 36: ["haste", 1], 37: ["exp", 1], 38: ["ap", 1], 41: ["heal", 1], 42: ["sp", 1], 45: ["sp", 1],
  43: ["mp5", 1], 50: ["armor", 1],
};

/** Caractéristiques d'un objet dans les unités des poids (toucher et critique en %). */
export function itemStats(d: ItemDetails | null | undefined): Partial<Record<WeightKey, number>> {
  const out: Partial<Record<WeightKey, number>> = {};
  for (const [type, v] of d?.stats ?? []) {
    const k = STAT_KEY[type];
    if (k) out[k[0]] = (out[k[0]] ?? 0) + v / k[1];
  }
  if (d?.armor) out.armor = (out.armor ?? 0) + d.armor;
  if (d?.dmg) out.wdps = d.dmg.dps;
  return out;
}

/* ---------- Profils par spé ---------- */

export interface BisProfile {
  key: string;
  cls: ClassName;
  spec: string;
  /** Sous-classes d'armure portées (classe d'objet 4 ; 0 = divers : cou, doigts, bijoux, et tissu des capes). */
  armor: number[];
  /** Sous-classes d'armes (classe d'objet 2). */
  weapons: number[];
  /** Sous-classe de relique (idole, libram, totem), dans l'emplacement « Ranged / Relic ». */
  relic?: number;
  /**
   * Types d'objet acceptés en main gauche (InventoryType) : 23 tenu en main gauche, 14 bouclier, 13 / 22 armes
   * (ambidextrie). Le Druide ne porte pas deux armes.
   */
  offHand: number[];
  /** Cap de toucher contre un boss de raid (%). */
  hitCap: number;
  weights: Weights;
}

/**
 * Valeurs par défaut (équivalent puissance d'attaque pour le Félin) : 1 Force = 2 PA, 1 Agilité = 1 PA + 1/20 % de
 * critique, 14 PA = 1 DPS, 1 % de critique ≈ 22 PA, 1 % de toucher ≈ 20 PA jusqu'au cap de 8 % (icy-veins, Forever).
 * Ours : survie d'abord (Endurance, armure, défense, esquive), puis menace.
 */
export const BIS_PROFILES: BisProfile[] = [
  {
    key: "druid-feral-cat", cls: "Druid", spec: "Feral Cat", armor: [0, 1, 2], weapons: [4, 5, 10, 13, 15], relic: 8, offHand: [23], hitCap: 8,
    weights: { str: 2, agi: 2.1, ap: 1, crit: 22, hit: 20, wdps: 14, sta: 0, exp: 1.5 },
  },
  {
    key: "druid-feral-bear", cls: "Druid", spec: "Feral Bear", armor: [0, 1, 2], weapons: [4, 5, 10, 13, 15], relic: 8, offHand: [23], hitCap: 8,
    weights: { sta: 1.5, armor: 0.1, def: 1.5, dodge: 1.2, agi: 1.2, str: 0.6, ap: 0.3, hit: 8, crit: 4, wdps: 3, exp: 1 },
  },
];

export const bisProfile = (cls: string, spec: string) => BIS_PROFILES.find(p => p.cls === cls && p.spec === spec) ?? null;

/** Poids effectifs : défaut de la spé, puis ceux de la guilde, puis ceux du joueur (les plus précis l'emportent). */
export function mergeWeights(...layers: (Weights | null | undefined)[]): Weights {
  const out: Weights = {};
  for (const l of layers) for (const k of WEIGHT_KEYS) {
    const v = l?.[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/* ---------- Toucher déjà acquis ---------- */

/** Talents qui donnent du toucher (% par rang). Nature's Reach : 2 rangs, 4 % au total (Forever). */
export const HIT_TALENTS: { cls: ClassName; name: string; perRank: number }[] = [
  { cls: "Druid", name: "Nature's Reach", perRank: 2 },
];
/** Bonus de toucher des races (Nain : Artisan's Precision, 26/10 ; le Tauren a perdu le sien). */
export const RACE_HIT: Record<string, number> = { Dwarf: 1 };

export function talentHit(cls: string, talents: { name: string; rank: number }[]): number {
  let sum = 0;
  for (const t of talents) {
    const h = HIT_TALENTS.find(x => x.cls === cls && x.name === t.name);
    if (h) sum += h.perRank * t.rank;
  }
  return sum;
}

/* ---------- Objets ---------- */

/** Provenance d'un objet. Les noms propres (lieux, PNJ, factions) restent dans la langue du jeu. */
export interface BisSource {
  kind: "drop" | "quest" | "craft" | "vendor" | "reputation" | "pvp" | "world" | "raid" | "other";
  /** Instance ou zone (« Stratholme », « Stranglethorn Vale »). */
  where?: string;
  /** Boss, PNJ ou quête. */
  npc?: string;
  /** Métier (nom anglais du jeu, comme PRIMARY_PROFESSIONS) et compétence. */
  profession?: string;
  skill?: number;
  /** Prix chez un vendeur (« 100 Tarnished Undermine Real »). */
  cost?: string;
  /** Réputation : faction et rang (neutral, friendly, honored, revered, exalted). */
  faction?: string;
  standing?: "neutral" | "friendly" | "honored" | "revered" | "exalted";
  /**
   * D'où vient l'information : graine du code (web), addon, admin, ou « auto » (données du jeu : recette, réputation,
   * rang JcJ). Une provenance « auto » s'affiche mais ne rend pas l'objet obtenable à elle seule : une recette ou une
   * réputation peut exister dans les fichiers sans être en jeu.
   */
  from?: "seed" | "addon" | "admin" | "auto";
  /** Page web qui l'a donnée (graine). */
  ref?: string;
}

const KIND_FR: Record<BisSource["kind"], string> = {
  drop: "Butin", quest: "Quête", craft: "Artisanat", vendor: "Vendeur", reputation: "Réputation", pvp: "JcJ", world: "Butin du monde", raid: "Raid", other: "Autre",
};
const KIND_EN: Record<BisSource["kind"], string> = {
  drop: "Drop", quest: "Quest", craft: "Crafted", vendor: "Vendor", reputation: "Reputation", pvp: "PvP", world: "World drop", raid: "Raid", other: "Other",
};
const PROFESSION_FR: Record<string, string> = {
  Leatherworking: "Travail du cuir", Blacksmithing: "Forge", Tailoring: "Couture", Engineering: "Ingénierie", Enchanting: "Enchantement", Alchemy: "Alchimie",
};
const STANDING_FR = { neutral: "neutre", friendly: "amical", honored: "honoré", revered: "révéré", exalted: "exalté" } as const;
const STANDING_EN = { neutral: "Neutral", friendly: "Friendly", honored: "Honored", revered: "Revered", exalted: "Exalted" } as const;

/** Libellé court d'une provenance : « Stratholme · Baron Rivendare », « Travail du cuir 300 », « Pix Xizzix · 100 … ». */
export function sourceLabel(src: BisSource, lang: "fr" | "en" = "fr"): string {
  const en = lang === "en";
  const parts: string[] = [];
  if (src.kind === "craft" && src.profession) parts.push(`${en ? src.profession : PROFESSION_FR[src.profession] ?? src.profession}${src.skill ? ` ${src.skill}` : ""}`);
  if (src.where) parts.push(src.where);
  if (src.npc) parts.push(src.npc);
  if (src.faction) parts.push(src.standing ? `${src.faction} (${(en ? STANDING_EN : STANDING_FR)[src.standing]})` : src.faction);
  if (src.cost) parts.push(src.cost);
  return parts.length ? parts.join(" · ") : (en ? KIND_EN : KIND_FR)[src.kind];
}
export const sourceKindLabel = (kind: BisSource["kind"], lang: "fr" | "en" = "fr") => (lang === "en" ? KIND_EN : KIND_FR)[kind];

/**
 * Faction d'un objet. Les données du jeu de Forever ne la portent pas pour les objets JcJ (les deux versions ont les
 * mêmes drapeaux et toutes les races autorisées) : on la lit d'abord dans le masque de races quand il est restreint,
 * puis dans le nom (titres des rangs JcJ, paires d'objets Theramore / Darkspear vues en jeu). null : les deux.
 */
const ALLIANCE_RACES = [1, 3, 4, 7], HORDE_RACES = [2, 5, 6, 8];
const ALLIANCE_NAME = /^(Private|Corporal|Sergeant Major|Master Sergeant|Knight|Knight-Lieutenant|Knight-Captain|Knight-Champion|Lieutenant Commander|Commander|Marshal|Field Marshal|Grand Marshal)'s |^Premier (Knight|Lieutenant Commander|Commander|Marshal|Field Marshal|Grand Marshal)|^Theramore |^Stormpike /;
const HORDE_NAME = /^(Scout|Grunt|Senior Sergeant|First Sergeant|Stone Guard|Blood Guard|Legionnaire|Centurion|Champion|Lieutenant General|General|Warlord|High Warlord)'s |^Premier (Stone Guard|Blood Guard|Legionnaire|Centurion|Champion|Lieutenant General|General|Warlord|High Warlord)|^Darkspear |^Frostwolf /;
export function itemFaction(name: string, races?: number | null): Faction | null {
  if (races && races !== -1) {
    const has = (r: number) => (races & (1 << (r - 1))) !== 0;
    const a = ALLIANCE_RACES.some(has), h = HORDE_RACES.some(has);
    if (a && !h) return "Alliance";
    if (h && !a) return "Horde";
  }
  if (ALLIANCE_NAME.test(name)) return "Alliance";
  if (HORDE_NAME.test(name)) return "Horde";
  return null;
}

export interface BisItem {
  id: number; name: string; quality: number; itemLevel: number; reqLevel: number;
  classId: number; subclassId: number; inventoryType: number;
  details: ItemDetails;
  /** Faction qui peut le porter (null : les deux). */
  faction?: Faction | null;
  /** Rang PvP requis (0 ou absent : aucun). */
  pvpRank?: number;
  /** Vu dans le cache du jeu d'un joueur. */
  seen?: boolean;
  source?: BisSource | null;
  /** Marqué « non obtenable » par un admin. */
  unobtainable?: boolean;
}

export const isPvp = (it: BisItem) => (it.pvpRank ?? 0) > 0 || it.source?.kind === "pvp";
export const isBoe = (it: BisItem) => it.details.bond === 2;
/** Objet à effet : relique, ou effet « Utiliser », « Équipé » ou « Chances quand vous touchez » (non chiffré). */
export const hasEffect = (it: BisItem) => it.inventoryType === 28 || (it.details.effects?.length ?? 0) > 0;
export const isObtainable = (it: BisItem) => !it.unobtainable && (!!it.seen || (!!it.source && it.source.from !== "auto"));

export interface BisFilters {
  faction?: Faction | null;
  /** Niveau du perso (objets de niveau requis supérieur écartés). */
  level?: number;
  /** "all" (défaut), "none" (sans PvP) ou rang PvP maximum. */
  pvp?: "all" | "none" | number;
  /** Écarter les objets liés quand équipés. */
  noBoe?: boolean;
  /** Garder aussi les objets non obtenables (vue admin). */
  includeUnobtainable?: boolean;
}

/** L'objet peut-il être porté par cette spé, et passe-t-il les filtres ? */
export function usable(it: BisItem, p: BisProfile, f: BisFilters = {}): boolean {
  if (it.classId === 4) {
    if (it.inventoryType === 28) { if (p.relic === undefined || it.subclassId !== p.relic) return false; }
    else if (!p.armor.includes(it.subclassId)) return false;
  } else if (it.classId === 2) {
    if (!p.weapons.includes(it.subclassId)) return false;
  } else return false;
  if (f.level !== undefined && it.reqLevel > f.level) return false;
  if (f.faction && it.faction && it.faction !== f.faction) return false;
  if (!f.includeUnobtainable && !isObtainable(it)) return false;
  if (f.noBoe && isBoe(it)) return false;
  if (f.pvp === "none" && isPvp(it)) return false;
  if (typeof f.pvp === "number" && (it.pvpRank ?? 0) > f.pvp) return false;
  return true;
}

/** L'emplacement accepte-t-il l'objet, pour cette spé (main gauche : selon le profil) ? */
export const slotAccepts = (slot: GearSlot, it: BisItem, p: BisProfile) =>
  slot === "Off Hand" ? p.offHand.includes(it.inventoryType) : SLOT_INVENTORY_TYPES[slot].includes(it.inventoryType);

/* ---------- Score ---------- */

export interface ItemScore {
  /** Valeur sans le toucher. */
  base: number;
  /** Toucher de l'objet (%). */
  hit: number;
  /** Valeur avec le toucher qui compte encore (jusqu'au cap). */
  total: number;
  effect: boolean;
}

/** Score d'un objet ; `hitRoom` = toucher qui manque encore avant le cap (%), sans compter cet objet. */
export function scoreItem(it: BisItem, w: Weights, hitRoom: number): ItemScore {
  const st = itemStats(it.details);
  let base = 0;
  for (const k of WEIGHT_KEYS) if (k !== "hit") base += (w[k] ?? 0) * (st[k] ?? 0);
  const hit = st.hit ?? 0;
  const total = base + (w.hit ?? 0) * Math.min(hit, Math.max(0, hitRoom));
  const r = (x: number) => Math.round(x * 10) / 10;
  return { base: r(base), hit: r(hit), total: r(total), effect: hasEffect(it) };
}

export interface RankedItem { item: BisItem; score: ItemScore }

/**
 * Toutes les options d'un emplacement : d'abord les objets chiffrés, du plus fort au moins fort ; puis les objets à
 * effet, à part, par ordre alphabétique (leur effet n'est pas chiffré).
 */
export function rankSlot(items: BisItem[], slot: GearSlot, p: BisProfile, w: Weights, hitRoom: number, f: BisFilters = {}) {
  const scored: RankedItem[] = [], effects: RankedItem[] = [];
  for (const it of items) {
    if (!slotAccepts(slot, it, p) || !usable(it, p, f)) continue;
    const score = scoreItem(it, w, hitRoom);
    (score.effect ? effects : scored).push({ item: it, score });
  }
  scored.sort((a, b) => b.score.total - a.score.total || b.item.itemLevel - a.item.itemLevel || a.item.name.localeCompare(b.item.name));
  effects.sort((a, b) => a.item.name.localeCompare(b.item.name));
  return { scored, effects };
}

/* ---------- Proposition d'une BiS complète ---------- */

export interface BisProposal {
  slots: Partial<Record<GearSlot, RankedItem>>;
  /** Toucher apporté par l'équipement proposé (%). */
  gearHit: number;
  /** Toucher total (talents + race + équipement), plafonné à l'affichage par l'appelant. */
  totalHit: number;
  total: number;
}

const TWO_HAND = 17;

/**
 * Meilleure combinaison sous le cap de toucher : on part du meilleur objet de chaque emplacement, puis on revoit
 * chaque emplacement tant que le total progresse (le toucher est partagé entre les emplacements). Les objets à
 * effet ne sont pas proposés (non chiffrés). `fixed` garde un objet imposé (déjà obtenu…) dans un emplacement.
 */
export function proposeBis(
  items: BisItem[], p: BisProfile, w: Weights, opts: { hitHave: number; filters?: BisFilters; fixed?: Partial<Record<GearSlot, BisItem>>; slots?: GearSlot[] },
): BisProposal {
  const f = opts.filters ?? {};
  const slots = (opts.slots ?? GEAR_SLOTS.filter(s => s !== "Ranged / Relic")).slice();
  const cands = new Map<GearSlot, BisItem[]>();
  for (const s of slots) {
    // Objets sans valeur pour la spé (score nul ou négatif) : jamais proposés, l'emplacement reste à choisir.
    const list = items.filter(it => slotAccepts(s, it, p) && usable(it, p, f) && !hasEffect(it) && scoreItem(it, w, p.hitCap).total > 0);
    list.sort((a, b) => scoreItem(b, w, p.hitCap).total - scoreItem(a, w, p.hitCap).total);
    cands.set(s, list.slice(0, 40));
  }
  const sel = new Map<GearSlot, BisItem | null>();
  const evaluate = (m: Map<GearSlot, BisItem | null>) => {
    const main = m.get("Main Hand");
    let hit = 0, base = 0;
    for (const [s, it] of m) {
      if (!it || (s === "Off Hand" && main?.inventoryType === TWO_HAND)) continue;
      const sc = scoreItem(it, w, 0);
      hit += sc.hit; base += sc.base;
    }
    const room = Math.max(0, p.hitCap - opts.hitHave);
    return { total: base + (w.hit ?? 0) * Math.min(hit, room), hit };
  };
  const conflicts = (m: Map<GearSlot, BisItem | null>, s: GearSlot, it: BisItem) => {
    for (const [o, x] of m) if (o !== s && x && x.id === it.id) return true;
    return false;
  };
  for (const s of slots) sel.set(s, opts.fixed?.[s] ?? null);
  for (const s of slots) if (!sel.get(s)) sel.set(s, cands.get(s)!.find(it => !conflicts(sel, s, it)) ?? null);
  for (let pass = 0; pass < 6; pass++) {
    let changed = false;
    for (const s of slots) {
      if (opts.fixed?.[s]) continue;
      let best = sel.get(s) ?? null, bestTotal = evaluate(sel).total;
      for (const it of cands.get(s)!) {
        if (it === best || conflicts(sel, s, it)) continue;
        const trial = new Map(sel).set(s, it);
        const t = evaluate(trial).total;
        if (t > bestTotal + 1e-9) { best = it; bestTotal = t; }
      }
      if (best !== sel.get(s)) { sel.set(s, best); changed = true; }
    }
    if (!changed) break;
  }
  // Arme à deux mains : la main gauche reste vide.
  if (sel.get("Main Hand")?.inventoryType === TWO_HAND) sel.set("Off Hand", null);
  const { total, hit } = evaluate(sel);
  const room = Math.max(0, p.hitCap - opts.hitHave);
  const out: Partial<Record<GearSlot, RankedItem>> = {};
  let used = 0;
  for (const [s, it] of sel) {
    if (!it) continue;
    const before = Math.max(0, room - used);
    const score = scoreItem(it, w, before);
    used += score.hit;
    out[s] = { item: it, score };
  }
  const r = (x: number) => Math.round(x * 10) / 10;
  return { slots: out, gearHit: r(hit), totalHit: r(hit + opts.hitHave), total: r(total) };
}

/* ---------- Import de poids (Pawn) ---------- */

/** Noms des caractéristiques chez Pawn (et quelques variantes courantes) → clé de poids. */
const PAWN_KEYS: Record<string, WeightKey> = {
  strength: "str", agility: "agi", stamina: "sta", intellect: "int", spirit: "spi",
  ap: "ap", attackpower: "ap", feralap: "ap", rap: "ap",
  crit: "crit", critrating: "crit", critpercent: "crit", meleecrit: "crit", spellcrit: "crit",
  hit: "hit", hitrating: "hit", hitpercent: "hit", meleehit: "hit", spellhit: "hit",
  expertise: "exp", expertiserating: "exp", haste: "haste", hasterating: "haste",
  dps: "wdps", meleedps: "wdps", weapondps: "wdps",
  armor: "armor", bonusarmor: "armor", defense: "def", defenserating: "def", dodge: "dodge", dodgerating: "dodge",
  parry: "parry", parryrating: "parry",
  spelldamage: "sp", spellpower: "sp", healing: "heal", mp5: "mp5",
};

export type WeightsImport = { ok: true; name: string | null; weights: Weights; ignored: string[] } | { ok: false; error: string };

/**
 * Chaîne Pawn « ( Pawn: v1: "Nom": Class=Druid, Agility=2.1, Strength=2, … ) », ou simple liste « Agility=2.1, … ».
 * Les valeurs de Pawn sont prises par point, et par 1 % pour le toucher et le critique (convention de Classic).
 */
export function parseWeightsImport(input: string): WeightsImport {
  const text = input.trim();
  if (!text) return { ok: false, error: "Colle une chaîne Pawn ou une liste « Caractéristique=valeur »." };
  if (text.length > 4000) return { ok: false, error: "Texte trop long pour une chaîne de poids." };
  const pawn = text.match(/^\(\s*Pawn\s*:\s*v1\s*:\s*"([^"]*)"\s*:(.*)\)\s*$/is);
  const name = pawn ? pawn[1]!.trim() || null : null;
  const body = pawn ? pawn[2]! : text;
  const weights: Weights = {}; const ignored: string[] = [];
  for (const part of body.split(/[,;\n]/)) {
    if (/^\s*(class|spec)\s*[=:]/i.test(part)) continue;
    const m = part.trim().match(/^([A-Za-z][A-Za-z0-9 ]*?)\s*[=:]\s*(-?\d+(?:[.,]\d+)?)$/);
    if (!m) { if (part.trim()) ignored.push(part.trim()); continue; }
    const k = PAWN_KEYS[m[1]!.replace(/\s+/g, "").toLowerCase()];
    if (!k) { ignored.push(m[1]!.trim()); continue; }
    const v = Number(m[2]!.replace(",", "."));
    if (Number.isFinite(v) && Math.abs(v) <= 1000) weights[k] = v;
  }
  if (!Object.keys(weights).length) return { ok: false, error: "Aucune caractéristique reconnue dans ce texte." };
  return { ok: true, name, weights, ignored };
}
