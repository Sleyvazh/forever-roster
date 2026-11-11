/**
 * Infobulles d'objets : libellés et mise en forme, partagés par l'API (calcul à l'import) et le site (affichage).
 * Les valeurs viennent des tables du jeu ; les libellés existent en français et en anglais (les mots du jeu anglais), choisis
 * par le paramètre `lang` (français par défaut).
 */
export type ItemLang = "fr" | "en";

/** Détails calculés à l'import (voir apps/api/src/gamedata/details.ts). */
export interface ItemDetails {
  /** 1 : lié quand ramassé, 2 : quand équipé, 3 : quand utilisé, 4 : objet de quête. */
  bond?: number;
  unique?: boolean;
  armor?: number;
  /** Arme : dégâts, vitesse (s) et dégâts par seconde. */
  dmg?: { min: number; max: number; speed: number; dps: number };
  /** [type de caractéristique, valeur] dans l'ordre du jeu. */
  stats?: [number, number][];
  /** 0 : Utiliser, 1 : Équipé, 2 : Chances quand vous touchez. */
  effects?: { trigger: number; text: string }[];
  set?: { id: number; name: string; items: string[]; bonuses: { n: number; text: string }[] };
  /** Prix de vente en pièces de cuivre. */
  sell?: number;
  /** Nom du fichier d'icône (ex. inv_shoulder_08, ou f<identifiant> si le nom est inconnu), servi depuis /icons/items/. */
  icon?: string;
  /** Identifiant du fichier d'icône dans les données du jeu (pour le récupérer quand Blizzard ne le sert pas). */
  iconId?: number;
}

export const BOND_LABEL: Record<number, string> = {
  1: "Lié quand ramassé", 2: "Lié quand équipé", 3: "Lié quand utilisé", 4: "Objet de quête",
};
export const TRIGGER_LABEL: Record<number, string> = { 0: "Utiliser", 1: "Équipé", 2: "Chances quand vous touchez" };
export const BOND_LABEL_EN: Record<number, string> = {
  1: "Binds when picked up", 2: "Binds when equipped", 3: "Binds when used", 4: "Quest Item",
};
export const TRIGGER_LABEL_EN: Record<number, string> = { 0: "Use", 1: "Equip", 2: "Chance on hit" };

/** Emplacement (InventoryType du jeu). */
export const INVENTORY_LABEL: Record<number, string> = {
  1: "Tête", 2: "Cou", 3: "Épaule", 4: "Chemise", 5: "Torse", 6: "Taille", 7: "Jambes", 8: "Pieds", 9: "Poignets", 10: "Mains",
  11: "Doigt", 12: "Bijou", 13: "À une main", 14: "Main gauche", 15: "À distance", 16: "Dos", 17: "Deux mains", 18: "Sac",
  19: "Tabard", 20: "Torse", 21: "Main droite", 22: "Main gauche", 23: "Tenu en main gauche", 24: "Projectile", 25: "Armes de jet",
  26: "À distance", 28: "Relique",
};
export const INVENTORY_LABEL_EN: Record<number, string> = {
  1: "Head", 2: "Neck", 3: "Shoulder", 4: "Shirt", 5: "Chest", 6: "Waist", 7: "Legs", 8: "Feet", 9: "Wrist", 10: "Hands",
  11: "Finger", 12: "Trinket", 13: "One-Hand", 14: "Off Hand", 15: "Ranged", 16: "Back", 17: "Two-Hand", 18: "Bag",
  19: "Tabard", 20: "Chest", 21: "Main Hand", 22: "Off Hand", 23: "Held In Off-hand", 24: "Projectile", 25: "Thrown",
  26: "Ranged", 28: "Relic",
};

/** Caractéristiques « blanches » (sous l'armure) : principales et résistances. */
const PRIMARY: Record<number, string> = {
  3: "Agilité", 4: "Force", 5: "Intelligence", 6: "Esprit", 7: "Endurance",
  51: "Résistance au Feu", 52: "Résistance au Givre", 53: "Résistance au Sacré", 54: "Résistance à l'Ombre",
  55: "Résistance à la Nature", 56: "Résistance aux Arcanes",
};
/** Score nécessaire pour 1 % (constaté sur les objets du jeu : Lionheart Helm, Quick Strike Ring…). */
const PERCENT: Record<number, [number, string]> = {
  31: [10, "Augmente vos chances de toucher de"],
  32: [14, "Augmente vos chances d'infliger un coup critique de"],
};
const EQUIP: Record<number, (v: number) => string> = {
  12: v => `Défense augmentée de ${v}.`,
  13: v => `Augmente votre score d'esquive de ${v}.`,
  14: v => `Augmente votre score de parade de ${v}.`,
  15: v => `Augmente votre score de blocage de ${v}.`,
  36: v => `Augmente votre score de hâte de ${v}.`,
  37: v => `Augmente votre score d'expertise de ${v}.`,
  38: v => `+${v} à la puissance d'attaque.`,
  39: v => `+${v} à la puissance d'attaque à distance.`,
  41: v => `Augmente les soins prodigués de ${v} au maximum.`,
  42: v => `Augmente les dégâts des sorts de ${v} au maximum.`,
  43: v => `Rend ${v} points de mana toutes les 5 s.`,
  45: v => `Augmente les dégâts et les soins des sorts de ${v} au maximum.`,
  46: v => `Rend ${v} points de vie toutes les 5 s.`,
  47: v => `Augmente la pénétration de vos sorts de ${v}.`,
  48: v => `Augmente la valeur de blocage de votre bouclier de ${v}.`,
  50: v => `+${v} à l'armure.`,
};
const PRIMARY_EN: Record<number, string> = {
  3: "Agility", 4: "Strength", 5: "Intellect", 6: "Spirit", 7: "Stamina",
  51: "Fire Resistance", 52: "Frost Resistance", 53: "Holy Resistance", 54: "Shadow Resistance",
  55: "Nature Resistance", 56: "Arcane Resistance",
};
const PERCENT_EN: Record<number, string> = { 31: "Improves your chance to hit by", 32: "Improves your chance to get a critical strike by" };
const EQUIP_EN: Record<number, (v: number) => string> = {
  12: v => `Increased Defense +${v}.`,
  13: v => `Increases your dodge rating by ${v}.`,
  14: v => `Increases your parry rating by ${v}.`,
  15: v => `Increases your block rating by ${v}.`,
  36: v => `Increases your haste rating by ${v}.`,
  37: v => `Increases your expertise rating by ${v}.`,
  38: v => `+${v} Attack Power.`,
  39: v => `+${v} ranged Attack Power.`,
  41: v => `Increases healing done by spells and effects by up to ${v}.`,
  42: v => `Increases damage done by magical spells and effects by up to ${v}.`,
  43: v => `Restores ${v} mana per 5 sec.`,
  45: v => `Increases damage and healing done by magical spells and effects by up to ${v}.`,
  46: v => `Restores ${v} health per 5 sec.`,
  47: v => `Decreases the magical resistances of your spell targets by ${v}.`,
  48: v => `Increases the block value of your shield by ${v}.`,
  50: v => `+${v} Armor.`,
};

export type StatLine = { kind: "primary" | "equip"; text: string; type: number; value: number };

export function statLine(type: number, value: number, lang: ItemLang = "fr"): StatLine {
  const sign = value >= 0 ? "+" : "";
  const en = lang === "en";
  const primary = (en ? PRIMARY_EN : PRIMARY)[type];
  if (primary) return { kind: "primary", text: `${sign}${value} ${primary}`, type, value };
  const pct = PERCENT[type];
  if (pct) {
    const p = Math.round((value / pct[0]) * 10) / 10;
    return { kind: "equip", text: en ? `${PERCENT_EN[type]} ${p}%.` : `${pct[1]} ${String(p).replace(".", ",")} %.`, type, value };
  }
  const f = (en ? EQUIP_EN : EQUIP)[type];
  return { kind: "equip", text: f ? f(value) : en ? `Stat #${type}: ${sign}${value}.` : `Caractéristique n° ${type} : ${sign}${value}.`, type, value };
}

/** Nom court d'une caractéristique, pour la comparaison. */
export function statName(type: number, lang: ItemLang = "fr") {
  if (lang === "en") {
    if (PRIMARY_EN[type]) return PRIMARY_EN[type]!;
    return ({ 31: "Hit", 32: "Crit", 12: "Defense", 13: "Dodge", 14: "Parry", 15: "Block", 38: "Attack Power",
      39: "Ranged AP", 41: "Healing", 42: "Spell Damage", 43: "Mana /5 s", 45: "Spell Power", 46: "Health /5 s",
      47: "Spell Penetration", 48: "Block Value", 50: "Armor" } as Record<number, string>)[type] ?? `Stat ${type}`;
  }
  if (PRIMARY[type]) return PRIMARY[type]!;
  return ({ 31: "Toucher", 32: "Critique", 12: "Défense", 13: "Esquive", 14: "Parade", 15: "Blocage", 38: "Puissance d'attaque",
    39: "PA à distance", 41: "Soins", 42: "Dégâts des sorts", 43: "Mana /5 s", 45: "Puissance des sorts", 46: "Vie /5 s",
    47: "Pénétration des sorts", 48: "Valeur de blocage", 50: "Armure" } as Record<number, string>)[type] ?? `Caractéristique ${type}`;
}

/** « 1 po 20 pa 5 pc » ; en anglais « 1g 20s 5c ». */
export function money(copper: number, lang: ItemLang = "fr") {
  const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
  const [pg, ps, pc] = lang === "en" ? ["g", "s", "c"] : [" po", " pa", " pc"];
  return [g && `${g}${pg}`, s && `${s}${ps}`, (c || (!g && !s)) && `${c}${pc}`].filter(Boolean).join(" ");
}

/** Différences entre deux objets (b - a) : niveau d'objet, armure, DPS et chaque caractéristique. */
export function compareItems(a: { itemLevel: number; details?: ItemDetails | null }, b: { itemLevel: number; details?: ItemDetails | null }, lang: ItemLang = "fr") {
  const out: { label: string; delta: number }[] = [];
  const push = (label: string, delta: number) => { if (Math.abs(delta) > 1e-9) out.push({ label, delta: Math.round(delta * 10) / 10 }); };
  push(lang === "en" ? "Item Level" : "Niveau d'objet", b.itemLevel - a.itemLevel);
  push(lang === "en" ? "Armor" : "Armure", (b.details?.armor ?? 0) - (a.details?.armor ?? 0));
  push("DPS", (b.details?.dmg?.dps ?? 0) - (a.details?.dmg?.dps ?? 0));
  const sum = (d?: ItemDetails | null) => {
    const m = new Map<number, number>();
    for (const [t, v] of d?.stats ?? []) m.set(t, (m.get(t) ?? 0) + v);
    return m;
  };
  const sa = sum(a.details), sb = sum(b.details);
  for (const t of new Set([...sa.keys(), ...sb.keys()])) push(statName(t, lang), (sb.get(t) ?? 0) - (sa.get(t) ?? 0));
  return out;
}

/** Type d'objet en français (armures et armes ; le client ne fournit que l'anglais). */
const SUBCLASS_FR: Record<string, string> = {
  Cloth: "Tissu", Leather: "Cuir", Mail: "Mailles", Plate: "Plaques", Shield: "Bouclier", Shields: "Bouclier", Buckler: "Targe",
  Miscellaneous: "Divers", Libram: "Libram", Librams: "Libram", Idol: "Idole", Idols: "Idole", Totem: "Totem", Totems: "Totem",
  Axe: "Hache", "One-Handed Axes": "Hache", "Two-Handed Axes": "Hache", Bow: "Arc", Bows: "Arc", Gun: "Arme à feu", Guns: "Arme à feu",
  Mace: "Masse", "One-Handed Maces": "Masse", "Two-Handed Maces": "Masse", Polearm: "Arme d'hast", Polearms: "Arme d'hast",
  Sword: "Épée", "One-Handed Swords": "Épée", "Two-Handed Swords": "Épée", Staff: "Bâton", Staves: "Bâton",
  "Fist Weapon": "Arme de pugilat", "Fist Weapons": "Arme de pugilat", Dagger: "Dague", Daggers: "Dague",
  Thrown: "Armes de jet", Spear: "Lance", Spears: "Lance", Crossbow: "Arbalète", Crossbows: "Arbalète", Wand: "Baguette", Wands: "Baguette",
  "Fishing Pole": "Canne à pêche", "Fishing Poles": "Canne à pêche",
};
export const subclassFr = (name: string | undefined) => (name ? SUBCLASS_FR[name] ?? name : "");
/** Type d'objet affiché : en français (subclassFr), ou le mot anglais du jeu au singulier (« One-Handed Axes » → « Axe »). */
export function subclassText(name: string | undefined, lang: ItemLang = "fr") {
  if (lang === "fr") return subclassFr(name);
  if (!name) return "";
  const one: Record<string, string> = { Shields: "Shield", Librams: "Libram", Idols: "Idol", Totems: "Totem", Bows: "Bow", Guns: "Gun",
    Polearms: "Polearm", Staves: "Staff", "Fist Weapons": "Fist Weapon", Daggers: "Dagger", Spears: "Spear", Crossbows: "Crossbow",
    Wands: "Wand", "Fishing Poles": "Fishing Pole" };
  return one[name] ?? name.replace(/^(One|Two)-Handed (Axe|Mace|Sword)s$/, "$2");
}

/** Progression d'équipement d'un perso : niveau d'objet moyen (objets équipés connus) et BiS obtenus. */
export interface GearStats { ilvl: number | null; filled: number; got: number; bis: number; total: number }
export function gearStats(
  gear: Partial<Record<string, { curId?: number | null; bisId?: number | null; bis?: string; got?: boolean } | undefined>>,
  slots: readonly string[], levelOf: (id: number) => number | undefined,
): GearStats {
  const levels = slots.map(s => gear[s]?.curId).map(id => (id ? levelOf(id) : undefined)).filter((v): v is number => !!v);
  return {
    ilvl: levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length * 10) / 10 : null,
    filled: levels.length,
    got: slots.filter(s => gear[s]?.got).length,
    bis: slots.filter(s => gear[s]?.bisId || gear[s]?.bis).length,
    total: slots.length,
  };
}


/** Type d'emplacement « arme à deux mains » (INVTYPE_2HWEAPON) : la main gauche est alors vide. */
export const INVTYPE_2H = 17;

type GearCur = { cur?: string; curId?: number | null; q?: number | null };
/** Retire l'objet porté d'un emplacement (l'objectif BiS et la case « obtenu » restent). */
export function withoutCurrent<T extends GearCur>(e: T | undefined): Omit<T, "cur" | "curId" | "q"> | undefined {
  if (!e) return e;
  const { cur: _c, curId: _i, q: _q, ...rest } = e;
  return rest;
}
