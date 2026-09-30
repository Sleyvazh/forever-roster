/**
 * Infobulles d'objets : libellés et mise en forme, partagés par l'API (calcul à l'import) et le site (affichage).
 * Les valeurs viennent des tables du jeu ; les libellés sont en français, comme le reste du site.
 */

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
  /** Nom du fichier d'icône (ex. inv_shoulder_08), servi depuis /icons/items/. */
  icon?: string;
}

export const BOND_LABEL: Record<number, string> = {
  1: "Lié quand ramassé", 2: "Lié quand équipé", 3: "Lié quand utilisé", 4: "Objet de quête",
};
export const TRIGGER_LABEL: Record<number, string> = { 0: "Utiliser", 1: "Équipé", 2: "Chances quand vous touchez" };

/** Emplacement (InventoryType du jeu). */
export const INVENTORY_LABEL: Record<number, string> = {
  1: "Tête", 2: "Cou", 3: "Épaule", 4: "Chemise", 5: "Torse", 6: "Taille", 7: "Jambes", 8: "Pieds", 9: "Poignets", 10: "Mains",
  11: "Doigt", 12: "Bijou", 13: "À une main", 14: "Main gauche", 15: "À distance", 16: "Dos", 17: "Deux mains", 18: "Sac",
  19: "Tabard", 20: "Torse", 21: "Main droite", 22: "Main gauche", 23: "Tenu en main gauche", 24: "Projectile", 25: "Armes de jet",
  26: "À distance", 28: "Relique",
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

export type StatLine = { kind: "primary" | "equip"; text: string; type: number; value: number };

export function statLine(type: number, value: number): StatLine {
  const sign = value >= 0 ? "+" : "";
  if (PRIMARY[type]) return { kind: "primary", text: `${sign}${value} ${PRIMARY[type]}`, type, value };
  const pct = PERCENT[type];
  if (pct) {
    const p = Math.round((value / pct[0]) * 10) / 10;
    return { kind: "equip", text: `${pct[1]} ${String(p).replace(".", ",")} %.`, type, value };
  }
  const f = EQUIP[type];
  return { kind: "equip", text: f ? f(value) : `Caractéristique n° ${type} : ${sign}${value}.`, type, value };
}

/** Nom court d'une caractéristique, pour la comparaison. */
export function statName(type: number) {
  if (PRIMARY[type]) return PRIMARY[type]!;
  return ({ 31: "Toucher", 32: "Critique", 12: "Défense", 13: "Esquive", 14: "Parade", 15: "Blocage", 38: "Puissance d'attaque",
    39: "PA à distance", 41: "Soins", 42: "Dégâts des sorts", 43: "Mana /5 s", 45: "Puissance des sorts", 46: "Vie /5 s",
    47: "Pénétration des sorts", 48: "Valeur de blocage", 50: "Armure" } as Record<number, string>)[type] ?? `Caractéristique ${type}`;
}

export function money(copper: number) {
  const g = Math.floor(copper / 10000), s = Math.floor((copper % 10000) / 100), c = copper % 100;
  return [g && `${g} po`, s && `${s} pa`, (c || (!g && !s)) && `${c} pc`].filter(Boolean).join(" ");
}

/** Différences entre deux objets (b - a) : niveau d'objet, armure, DPS et chaque caractéristique. */
export function compareItems(a: { itemLevel: number; details?: ItemDetails | null }, b: { itemLevel: number; details?: ItemDetails | null }) {
  const out: { label: string; delta: number }[] = [];
  const push = (label: string, delta: number) => { if (Math.abs(delta) > 1e-9) out.push({ label, delta: Math.round(delta * 10) / 10 }); };
  push("Niveau d'objet", b.itemLevel - a.itemLevel);
  push("Armure", (b.details?.armor ?? 0) - (a.details?.armor ?? 0));
  push("DPS", (b.details?.dmg?.dps ?? 0) - (a.details?.dmg?.dps ?? 0));
  const sum = (d?: ItemDetails | null) => {
    const m = new Map<number, number>();
    for (const [t, v] of d?.stats ?? []) m.set(t, (m.get(t) ?? 0) + v);
    return m;
  };
  const sa = sum(a.details), sb = sum(b.details);
  for (const t of new Set([...sa.keys(), ...sb.keys()])) push(statName(t), (sb.get(t) ?? 0) - (sa.get(t) ?? 0));
  return out;
}
