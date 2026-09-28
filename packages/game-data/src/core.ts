/**
 * Données de base de WoW Forever.
 * Source : https://foreverchanges.pro (races, raciaux, métiers). Niveau max 60.
 */

export type Faction = "Alliance" | "Horde";

export type Role = "Tank" | "Heal" | "DPS";

/**
 * Spés jouables : un intitulé, un rôle et l'arbre de talents principal (0, 1 ou 2).
 * Plusieurs intitulés peuvent partager un arbre (Feral Cat / Feral Bear, Holy DPS / Holy Heal…) :
 * c'est l'intitulé qui fixe le rôle dans le roster de raid.
 */
export interface SpecDef { name: string; role: Role; tree: 0 | 1 | 2 }
const s = (name: string, role: Role, tree: 0 | 1 | 2): SpecDef => ({ name, role, tree });

export const CLASS_SPECS = {
  Warrior: [s("Arms", "DPS", 0), s("Fury", "DPS", 1), s("Protection", "Tank", 2), s("Fury Tank", "Tank", 1)],
  Paladin: [s("Holy Heal", "Heal", 0), s("Holy DPS", "DPS", 0), s("Protection", "Tank", 1), s("Retribution", "DPS", 2)],
  Hunter: [s("Beast Mastery", "DPS", 0), s("Marksmanship", "DPS", 1), s("Survival", "DPS", 2)],
  Rogue: [s("Assassination", "DPS", 0), s("Combat", "DPS", 1), s("Subtlety", "DPS", 2)],
  Priest: [s("Discipline Heal", "Heal", 0), s("Discipline DPS", "DPS", 0), s("Holy", "Heal", 1), s("Shadow", "DPS", 2)],
  Shaman: [s("Elemental", "DPS", 0), s("Enhancement DPS", "DPS", 1), s("Enhancement Tank", "Tank", 1), s("Restoration", "Heal", 2)],
  Mage: [s("Arcane", "DPS", 0), s("Fire", "DPS", 1), s("Frost", "DPS", 2)],
  Warlock: [s("Affliction", "DPS", 0), s("Demonology", "DPS", 1), s("Destruction", "DPS", 2)],
  Druid: [s("Balance", "DPS", 0), s("Feral Cat", "DPS", 1), s("Feral Bear", "Tank", 1), s("Restoration", "Heal", 2)],
} satisfies Record<string, SpecDef[]>;

const names = (list: readonly SpecDef[]): readonly string[] => list.map(d => d.name);

export const CLASSES = {
  Warrior: { color: "#C69B6D", slug: "warrior", trees: ["Arms", "Fury", "Protection"], specs: names(CLASS_SPECS.Warrior) },
  Paladin: { color: "#F48CBA", slug: "paladin", trees: ["Holy", "Protection", "Retribution"], specs: names(CLASS_SPECS.Paladin) },
  Hunter: { color: "#AAD372", slug: "hunter", trees: ["Beast Mastery", "Marksmanship", "Survival"], specs: names(CLASS_SPECS.Hunter) },
  Rogue: { color: "#E8D340", slug: "rogue", trees: ["Assassination", "Combat", "Subtlety"], specs: names(CLASS_SPECS.Rogue) },
  Priest: { color: "#B9C2D6", slug: "priest", trees: ["Discipline", "Holy", "Shadow"], specs: names(CLASS_SPECS.Priest) },
  Shaman: { color: "#0070DD", slug: "shaman", trees: ["Elemental", "Enhancement", "Restoration"], specs: names(CLASS_SPECS.Shaman) },
  Mage: { color: "#3FC7EB", slug: "mage", trees: ["Arcane", "Fire", "Frost"], specs: names(CLASS_SPECS.Mage) },
  Warlock: { color: "#8788EE", slug: "warlock", trees: ["Affliction", "Demonology", "Destruction"], specs: names(CLASS_SPECS.Warlock) },
  Druid: { color: "#FF7C0A", slug: "druid", trees: ["Balance", "Feral Combat", "Restoration"], specs: names(CLASS_SPECS.Druid) },
} as const;

export type ClassName = keyof typeof CLASSES;
export const CLASS_NAMES = Object.keys(CLASSES) as ClassName[];

export const RACES: Record<string, { faction: Faction; classes: ClassName[]; racials: string }> = {
  Human: { faction: "Alliance", classes: ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Mage", "Warlock"], racials: "Will to Survive · Perception · Sword Specialization · The Human Spirit" },
  Dwarf: { faction: "Alliance", classes: ["Warrior", "Paladin", "Hunter", "Rogue", "Priest", "Shaman"], racials: "Stoneform · Find Treasure · Mace Specialization · Big Game Hunter" },
  "Night Elf": { faction: "Alliance", classes: ["Warrior", "Hunter", "Rogue", "Priest", "Druid"], racials: "Elune's Light · Shadowmeld · Quickness · Wisp Spirit" },
  Gnome: { faction: "Alliance", classes: ["Warrior", "Rogue", "Priest", "Mage", "Warlock"], racials: "Expansive Mind · Eureka! · Escape Artist · Engineering Specialization" },
  "Skyborne (High Order)": { faction: "Alliance", classes: ["Warrior", "Hunter", "Rogue", "Mage", "Druid"], racials: "Walk on Air · Read Ley Line · Wind Blessed (+1 % hâte) · Elemental Insight" },
  Orc: { faction: "Horde", classes: ["Warrior", "Hunter", "Rogue", "Shaman", "Mage", "Warlock"], racials: "Axe Specialization · Blood Fury · Shatter Curse · Hardiness" },
  Undead: { faction: "Horde", classes: ["Warrior", "Paladin", "Rogue", "Priest", "Mage", "Warlock"], racials: "Will of the Forsaken · Cannibalize · Underwater Breathing · Touch of the Grave" },
  Tauren: { faction: "Horde", classes: ["Warrior", "Hunter", "Shaman", "Druid"], racials: "Cultivation · War Stomp · Plainsrunning · Endurance (+5 % PV, +1 % toucher)" },
  Troll: { faction: "Horde", classes: ["Warrior", "Hunter", "Rogue", "Priest", "Shaman", "Mage", "Warlock"], racials: "Berserking · Rapid Regeneration · Beast Slaying · Regeneration" },
  "Skyborne (Windshaper)": { faction: "Horde", classes: ["Warrior", "Hunter", "Rogue", "Shaman", "Druid"], racials: "Walk on Air · Skysight · Wind Blessed (+1 % hâte) · Elemental Insight" },
};
export const RACE_NAMES = Object.keys(RACES);

const ROLE_BY_SPEC = new Map(Object.values(CLASS_SPECS).flat().map(d => [d.name, d.role]));
/** Rôle d'une spé d'après son intitulé (les intitulés ont le même rôle quelle que soit la classe). */
export function roleOf(spec: string | null | undefined): Role | null {
  if (!spec) return null;
  return ROLE_BY_SPEC.get(spec) ?? "DPS";
}

/** Définition d'une spé pour une classe donnée (rôle, arbre principal). */
export function specDef(cls: string, spec: string): SpecDef | null {
  return (CLASS_SPECS as Record<string, SpecDef[]>)[cls]?.find(d => d.name === spec) ?? null;
}

export function isValidCombo(race: string, cls: string): boolean {
  const r = RACES[race];
  return !!r && (r.classes as string[]).includes(cls);
}
export function isValidSpec(cls: string, spec: string): boolean {
  const c = CLASSES[cls as ClassName];
  return !!c && (c.specs as readonly string[]).includes(spec);
}

export const PRIMARY_PROFESSIONS: Record<string, string> = {
  Alchemy: "Performance Bonus (détails pas encore publiés).",
  Blacksmithing: "Performance Bonus (détails pas encore publiés).",
  Enchanting: "Performance Bonus (détails pas encore publiés).",
  Engineering: "Performance Bonus · gadgets plus fiables.",
  Leatherworking: "Performance Bonus (détails pas encore publiés).",
  Tailoring: "Performance Bonus (détails pas encore publiés).",
  Mining: "Bountiful Harvest (Legacy) : +20 % de matériaux rares par rang, jusqu'à +100 % au rang 5.",
  Herbalism: "Bountiful Harvest (Legacy) · les Tauren peuvent cultiver des herbes sans compétence.",
  Skinning: "Bountiful Harvest (Legacy) · bonus de chance de critique.",
};
export const SECONDARY_PROFESSIONS = {
  cooking: { name: "Cooking", bonus: "Master Chef (résultats en plus sur certaines recettes) · Gourmand (buffs de nourriture plus longs)." },
  fishing: { name: "Fishing", bonus: "Luremaster (chance de poisson en plus avec un leurre) · Fish Bowl : +8 % à toutes les caractéristiques." },
  firstAid: { name: "First Aid", bonus: "Field Medicine (détails pas encore publiés)." },
} as const;
export const PROFESSION_PAIRS: [string, string][] = [
  ["Skinning", "Leatherworking"], ["Mining", "Blacksmithing"], ["Mining", "Engineering"], ["Herbalism", "Alchemy"],
];
export function professionTier(skill: number): string {
  if (skill > 225) return "Artisan";
  if (skill > 150) return "Expert";
  if (skill > 75) return "Compagnon";
  if (skill > 0) return "Apprenti";
  return "Non appris";
}

export const GEAR_SLOTS = [
  "Head", "Neck", "Shoulder", "Back", "Chest", "Wrist", "Hands", "Waist", "Legs", "Feet",
  "Finger 1", "Finger 2", "Trinket 1", "Trinket 2", "Main Hand", "Off Hand", "Ranged / Relic",
] as const;
export const ITEM_QUALITIES = ["Médiocre", "Commun", "Inhabituel", "Rare", "Épique", "Légendaire"] as const;

export const LEGACY_TREES = [
  { key: "professions", name: "Professions", desc: "Montée de compétence, récolte, or" },
  { key: "adventure", name: "Adventure", desc: "Leveling et déplacements" },
  { key: "resourcefulness", name: "Resourcefulness", desc: "Entretien, buffs, réputation, honneur" },
] as const;

export const MAX_LEVEL = 60;
export const MAX_TALENT_POINTS = 51;
/** Points de talents disponibles à un niveau donné (1 point par niveau à partir du 10). */
export const talentPointsAt = (level: number) => Math.max(0, Math.min(MAX_TALENT_POINTS, level - 9));

/** Lancement mondial : 4 nov. 2026, 15:00 PST = 23:00 UTC. */
export const LAUNCH_AT = Date.UTC(2026, 10, 4, 23, 0, 0);
