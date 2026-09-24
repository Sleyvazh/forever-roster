/**
 * Données de base de WoW Forever.
 * Source : https://foreverchanges.pro (races, raciaux, métiers). Niveau max 60.
 */

export type Faction = "Alliance" | "Horde";

export const CLASSES = {
  Warrior: { color: "#C69B6D", slug: "warrior", trees: ["Arms", "Fury", "Protection"], specs: ["Arms", "Fury", "Protection"] },
  Paladin: { color: "#F48CBA", slug: "paladin", trees: ["Holy", "Protection", "Retribution"], specs: ["Holy", "Protection", "Retribution"] },
  Hunter: { color: "#AAD372", slug: "hunter", trees: ["Beast Mastery", "Marksmanship", "Survival"], specs: ["Beast Mastery", "Marksmanship", "Survival"] },
  Rogue: { color: "#E8D340", slug: "rogue", trees: ["Assassination", "Combat", "Subtlety"], specs: ["Assassination", "Combat", "Subtlety"] },
  Priest: { color: "#B9C2D6", slug: "priest", trees: ["Discipline", "Holy", "Shadow"], specs: ["Discipline", "Holy", "Shadow"] },
  Shaman: { color: "#0070DD", slug: "shaman", trees: ["Elemental", "Enhancement", "Restoration"], specs: ["Elemental", "Enhancement", "Restoration"] },
  Mage: { color: "#3FC7EB", slug: "mage", trees: ["Arcane", "Fire", "Frost"], specs: ["Arcane", "Fire", "Frost"] },
  Warlock: { color: "#8788EE", slug: "warlock", trees: ["Affliction", "Demonology", "Destruction"], specs: ["Affliction", "Demonology", "Destruction"] },
  Druid: { color: "#FF7C0A", slug: "druid", trees: ["Balance", "Feral Combat", "Restoration"], specs: ["Balance", "Feral Cat", "Feral Bear", "Restoration"] },
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

export type Role = "Tank" | "Heal" | "DPS";
const TANK_SPECS = ["Protection", "Feral Bear"];
const HEAL_SPECS = ["Holy", "Restoration", "Discipline"];
export function roleOf(spec: string | null | undefined): Role | null {
  if (!spec) return null;
  if (TANK_SPECS.includes(spec)) return "Tank";
  if (HEAL_SPECS.includes(spec)) return "Heal";
  return "DPS";
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
