import type { Role } from "./core";
import type { RaidEffect } from "./raid";

/**
 * Données de WoW Retail (Midnight, 12.x) pour Roster : 13 classes et 40 spés, difficultés et tailles de raid,
 * raids de Midnight, buffs et affaiblissements de raid. Clés en anglais (comme les persos de Forever),
 * libellés en français et en anglais (choix de chacun, langue du navigateur par défaut).
 * Sources : notes de mise à jour de Blizzard (12.0 à 12.1.5), Icy Veins (buffs de Midnight), JudgeHype (noms français des raids).
 */

export type GameLang = "fr" | "en";
export const GAME_LANGS = ["auto", "fr", "en"] as const;
export type GameLangPref = (typeof GAME_LANGS)[number];

export interface RetailSpec { name: string; fr: string; role: Role }
export interface RetailClass { name: string; fr: string; color: string; specs: RetailSpec[] }

const sp = (name: string, fr: string, role: Role = "DPS"): RetailSpec => ({ name, fr, role });

export const RETAIL_CLASSES: Record<string, RetailClass> = {
  "Death Knight": { name: "Death Knight", fr: "Chevalier de la mort", color: "#C41E3A", specs: [sp("Blood", "Sang", "Tank"), sp("Frost", "Givre"), sp("Unholy", "Impie")] },
  "Demon Hunter": { name: "Demon Hunter", fr: "Chasseur de démons", color: "#A330C9", specs: [sp("Havoc", "Dévastation"), sp("Vengeance", "Vengeance", "Tank"), sp("Devourer", "Dévoreur")] },
  Druid: { name: "Druid", fr: "Druide", color: "#FF7C0A", specs: [sp("Balance", "Équilibre"), sp("Feral", "Farouche"), sp("Guardian", "Gardien", "Tank"), sp("Restoration", "Restauration", "Heal")] },
  Evoker: { name: "Evoker", fr: "Évocateur", color: "#33937F", specs: [sp("Devastation", "Dévastation"), sp("Preservation", "Préservation", "Heal"), sp("Augmentation", "Augmentation")] },
  Hunter: { name: "Hunter", fr: "Chasseur", color: "#AAD372", specs: [sp("Beast Mastery", "Maîtrise des bêtes"), sp("Marksmanship", "Précision"), sp("Survival", "Survie")] },
  Mage: { name: "Mage", fr: "Mage", color: "#3FC7EB", specs: [sp("Arcane", "Arcanes"), sp("Fire", "Feu"), sp("Frost", "Givre")] },
  Monk: { name: "Monk", fr: "Moine", color: "#00FF98", specs: [sp("Brewmaster", "Maître brasseur", "Tank"), sp("Mistweaver", "Tisse-brume", "Heal"), sp("Windwalker", "Marche-vent")] },
  Paladin: { name: "Paladin", fr: "Paladin", color: "#F48CBA", specs: [sp("Holy", "Sacré", "Heal"), sp("Protection", "Protection", "Tank"), sp("Retribution", "Vindicte")] },
  Priest: { name: "Priest", fr: "Prêtre", color: "#FFFFFF", specs: [sp("Discipline", "Discipline", "Heal"), sp("Holy", "Sacré", "Heal"), sp("Shadow", "Ombre")] },
  Rogue: { name: "Rogue", fr: "Voleur", color: "#FFF468", specs: [sp("Assassination", "Assassinat"), sp("Outlaw", "Hors-la-loi"), sp("Subtlety", "Finesse")] },
  Shaman: { name: "Shaman", fr: "Chaman", color: "#0070DD", specs: [sp("Elemental", "Élémentaire"), sp("Enhancement", "Amélioration"), sp("Restoration", "Restauration", "Heal")] },
  Warlock: { name: "Warlock", fr: "Démoniste", color: "#8788EE", specs: [sp("Affliction", "Affliction"), sp("Demonology", "Démonologie"), sp("Destruction", "Destruction")] },
  Warrior: { name: "Warrior", fr: "Guerrier", color: "#C69B6D", specs: [sp("Arms", "Armes"), sp("Fury", "Fureur"), sp("Protection", "Protection", "Tank")] },
};
export const RETAIL_CLASS_NAMES = Object.keys(RETAIL_CLASSES);
export const RETAIL_MAX_LEVEL = 90;

export const isRetailClass = (cls: string) => Object.hasOwn(RETAIL_CLASSES, cls);
/** R2b : perso lu sur le compte Battle.net (liste d'import). `cls` : clé de classe du site ; `existing` : fiche déjà sur Roster. */
export interface BnetCharacter { id: number; name: string; realm: string; realmSlug: string; cls: string; level: number; faction: string; existing?: string | null }
/** Identifiants des classes dans l'API de Blizzard (playable_class.id). */
export const RETAIL_CLASS_IDS: Record<number, string> = {
  1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest", 6: "Death Knight", 7: "Shaman",
  8: "Mage", 9: "Warlock", 10: "Monk", 11: "Druid", 12: "Demon Hunter", 13: "Evoker",
};
export const retailSpec = (cls: string, spec: string) => RETAIL_CLASSES[cls]?.specs.find(s => s.name === spec) ?? null;

/* ---------- Raids : difficultés, tailles, raids de Midnight ---------- */

export const RETAIL_DIFFICULTIES = ["normal", "heroic", "mythic"] as const;
export type RetailDifficulty = (typeof RETAIL_DIFFICULTIES)[number];
export const DIFFICULTY_LABEL: Record<RetailDifficulty, Record<GameLang, string>> = {
  normal: { fr: "Normal", en: "Normal" }, heroic: { fr: "Héroïque", en: "Heroic" }, mythic: { fr: "Mythique", en: "Mythic" },
};
export const isRetailDifficulty = (d: unknown): d is RetailDifficulty => typeof d === "string" && (RETAIL_DIFFICULTIES as readonly string[]).includes(d);

export interface RetailRaid {
  key: string; en: string; fr: string; bosses: number;
  /** Mythique à effectif flexible (sinon 20 pile). */
  mythicFlex?: [number, number];
}
/** Raids de Midnight, du plus récent au plus ancien (proposés à la création d'un raid). */
export const RETAIL_RAIDS: RetailRaid[] = [
  { key: "kithix", en: "The Unbinding of Kith'ix", fr: "Déliement de Kith'ix", bosses: 1, mythicFlex: [15, 25] },
  { key: "venomous-abyss", en: "The Venomous Abyss", fr: "L'Abîme Venimeux", bosses: 8 },
  { key: "sporefall", en: "Sporefall", fr: "Chute-des-Spores", bosses: 1, mythicFlex: [15, 25] },
  { key: "voidspire", en: "The Voidspire", fr: "Flèche du Vide", bosses: 6 },
  { key: "dreamrift", en: "The Dreamrift", fr: "Faille du Rêve", bosses: 1 },
  { key: "march-on-queldanas", en: "March on Quel'Danas", fr: "Marche sur Quel'Danas", bosses: 2 },
];
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/^(the|l'|la|le|les)\s*/i, "").replace(/[^a-z0-9]+/g, "");
/** Raid de Midnight reconnu d'après le nom du raid (français ou anglais), sinon null. */
export function retailRaidOf(name: string): RetailRaid | null {
  const n = norm(name);
  if (!n) return null;
  return RETAIL_RAIDS.find(r => [r.en, r.fr].some(x => n.includes(norm(x)))) ?? null;
}
export const retailRaidLabel = (r: RetailRaid, lang: GameLang) => (lang === "fr" ? r.fr : r.en);

/** Effectif possible selon la difficulté : Normal et Héroïque de 10 à 30, Mythique 20 (ou flexible pour certains raids). */
export function retailSizeRange(difficulty: RetailDifficulty, raidName = ""): { min: number; max: number } {
  if (difficulty !== "mythic") return { min: 10, max: 30 };
  const flex = retailRaidOf(raidName)?.mythicFlex;
  return flex ? { min: flex[0], max: flex[1] } : { min: 20, max: 20 };
}
/** Effectif proposé par défaut (Mythique : 20 ; sinon 20, ramené dans la plage). */
export const retailDefaultSize = (difficulty: RetailDifficulty, raidName = "") => {
  const { min, max } = retailSizeRange(difficulty, raidName);
  return Math.max(min, Math.min(max, 20));
};
/** Rôles visés pour un effectif : 2 tanks, un heal pour 5 (au moins 2), le reste en DPS. */
export function retailTargets(size: number) {
  const tank = 2, heal = Math.max(2, Math.round(size / 5));
  return { tank, heal, dps: Math.max(0, size - tank - heal) };
}

/* ---------- Buffs et affaiblissements de raid de Midnight ---------- */

const any = (cls: string, specs?: string[]) => (specs ? { cls, specs } : { cls });
/** Une source suffit pour tout le raid (plus de buffs de groupe depuis longtemps sur Retail). */
export const RETAIL_EFFECTS: (RaidEffect & { fr: string; effect: Record<GameLang, string> })[] = [
  { id: "ai", name: "Arcane Intellect", fr: "Intelligence des Arcanes", kind: "buff", scope: "raid", providers: [any("Mage")], effect: { fr: "+3 % Intelligence", en: "+3% Intellect" } },
  { id: "fort", name: "Power Word: Fortitude", fr: "Mot de pouvoir : Robustesse", kind: "buff", scope: "raid", providers: [any("Priest")], effect: { fr: "+5 % Endurance", en: "+5% Stamina" } },
  { id: "bshout", name: "Battle Shout", fr: "Cri de guerre", kind: "buff", scope: "raid", providers: [any("Warrior")], effect: { fr: "+5 % puissance d'attaque", en: "+5% attack power" } },
  { id: "motw", name: "Mark of the Wild", fr: "Marque du fauve", kind: "buff", scope: "raid", providers: [any("Druid")], effect: { fr: "+3 % Polyvalence", en: "+3% Versatility" } },
  { id: "skyfury", name: "Skyfury", fr: "Fureur-du-ciel", kind: "buff", scope: "raid", providers: [any("Shaman")], effect: { fr: "+2 % Maîtrise", en: "+2% Mastery" } },
  { id: "bronze", name: "Blessing of the Bronze", fr: "Bénédiction du bronze", kind: "buff", scope: "raid", providers: [any("Evoker")], effect: { fr: "recharge des déplacements −15 %", en: "movement cooldowns −15%" } },
  { id: "devo", name: "Devotion Aura", fr: "Aura de dévotion", kind: "aura", scope: "raid", providers: [any("Paladin")], effect: { fr: "−3 % dégâts subis", en: "−3% damage taken" } },
  { id: "chaos", name: "Chaos Brand", fr: "Marque du chaos", kind: "debuff", scope: "raid", providers: [any("Demon Hunter")], effect: { fr: "+3 % dégâts magiques subis", en: "+3% magic damage taken" } },
  { id: "mystic", name: "Mystic Touch", fr: "Toucher mystique", kind: "debuff", scope: "raid", providers: [any("Monk")], effect: { fr: "+5 % dégâts physiques subis", en: "+5% physical damage taken" } },
  { id: "hmark", name: "Hunter's Mark", fr: "Marque du chasseur", kind: "debuff", scope: "raid", providers: [any("Hunter")], effect: { fr: "+3 % dégâts subis", en: "+3% damage taken" } },
  { id: "atrophic", name: "Atrophic Poison", fr: "Poison atrophique", kind: "debuff", scope: "raid", providers: [any("Rogue")], effect: { fr: "−3 % dégâts infligés par la cible", en: "target deals −3% damage" } },
  { id: "lust", name: "Bloodlust / Heroism", fr: "Furie sanguinaire / Héroïsme", kind: "utility", scope: "raid", providers: [any("Shaman"), any("Mage"), any("Hunter"), any("Evoker")], effect: { fr: "une fois par combat", en: "once per fight" } },
  { id: "brez", name: "Combat resurrection", fr: "Résurrection en combat", kind: "utility", scope: "raid", providers: [any("Death Knight"), any("Druid"), any("Warlock"), any("Paladin")], effect: { fr: "relever un mort pendant le combat", en: "raise a dead player mid-fight" } },
  { id: "gateway", name: "Demonic Gateway / Soulstone", fr: "Portail démoniaque / Pierre d'âme", kind: "utility", scope: "raid", providers: [any("Warlock")], effect: { fr: "déplacement, résurrection", en: "movement, resurrection" } },
];

/* ---------- Royaumes (création à la main ; liste complète avec Battle.net plus tard) et liens ---------- */

/** Royaumes francophones d'Europe, proposés à la saisie (on peut en taper un autre). */
export const FRENCH_REALMS = [
  "Archimonde", "Arak-arahm", "Arathi", "Chants éternels", "Cho'gall", "Confrérie du Thorium", "Conseil des Ombres", "Culte de la Rive noire",
  "Dalaran", "Drek'Thar", "Eitrigg", "Eldre'Thalas", "Elune", "Garona", "Hyjal", "Illidan", "Kael'thas", "Khaz Modan", "Kirin Tor", "Krasus",
  "La Croisade écarlate", "Les Clairvoyants", "Les Sentinelles", "Marécage de Zangar", "Medivh", "Naxxramas", "Ner'zhul", "Rashgarroth",
  "Sargeras", "Sinstralis", "Suramar", "Temple noir", "Throk'Feroth", "Uldaman", "Varimathras", "Vol'jin", "Ysondre",
];
/** Identifiant d'un royaume dans les adresses de Blizzard et des sites de référence (« Kael'thas » → « kaelthas »). */
export const realmSlug = (realm: string) => realm.trim().toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
  .replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
/** Liens vers l'Armurerie, Raider.IO et Warcraft Logs (région Europe) ; `slug` : celui donné par Battle.net, s'il est connu. */
export function retailLinks(name: string, realm: string, slug?: string) {
  const r = slug || realmSlug(realm), n = encodeURIComponent(name.trim().split(/\s+/)[0]!.toLowerCase());
  return {
    armory: `https://worldofwarcraft.blizzard.com/fr-fr/character/eu/${r}/${n}`,
    raiderio: `https://raider.io/characters/eu/${r}/${n}`,
    warcraftlogs: `https://www.warcraftlogs.com/character/eu/${r}/${n}`,
  };
}
