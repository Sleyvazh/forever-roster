import { CLASS_SPECS, type Role } from "./core";
import { instanceKey } from "./loot";

/**
 * Préparation d'un raid (lot G) : consommables demandés et fiches de boss (attributions), reprises du dernier raid
 * du même nom. Partagé par l'API, le site et l'export pour l'addon (lignes C, F et T du format FRG).
 */

/* ---------- Consommables ---------- */

/** À qui s'adresse une ligne de consommables : tout le monde, un rôle, ou un type de DPS. */
export const CONSUMABLE_TARGETS = ["all", "tank", "heal", "melee", "ranged", "caster"] as const;
export type ConsumableTarget = (typeof CONSUMABLE_TARGETS)[number];
export const CONSUMABLE_TARGET_LABEL: Record<ConsumableTarget, string> = {
  all: "Tout le monde", tank: "Tanks", heal: "Heals", melee: "DPS corps à corps", ranged: "DPS distance", caster: "DPS lanceurs de sorts",
};

export interface ConsumableLine { itemId: number; name: string; n: number; for: ConsumableTarget }

/** Spés DPS qui frappent avec des sorts, et celles à distance (le reste est au corps à corps). */
const CASTER_SPECS = new Set(["Mage:*", "Warlock:*", "Priest:Shadow", "Priest:Discipline DPS", "Druid:Balance", "Shaman:Elemental", "Paladin:Holy DPS"]);
const RANGED_SPECS = new Set(["Hunter:*"]);

/** Type de DPS d'une spé (null si la spé n'est pas DPS ou est inconnue). */
export function dpsType(cls: string, spec: string): "melee" | "ranged" | "caster" | null {
  const def = (CLASS_SPECS as Record<string, { name: string; role: Role }[]>)[cls]?.find(s => s.name === spec);
  if (!def || def.role !== "DPS") return null;
  if (CASTER_SPECS.has(`${cls}:*`) || CASTER_SPECS.has(`${cls}:${spec}`)) return "caster";
  if (RANGED_SPECS.has(`${cls}:*`)) return "ranged";
  return "melee";
}

/** Lignes qui concernent un joueur, selon le rôle et la spé de son inscription. */
export function concerns(line: Pick<ConsumableLine, "for">, who: { role: Role | null; cls: string; spec: string }): boolean {
  switch (line.for) {
    case "all": return true;
    case "tank": return who.role === "Tank";
    case "heal": return who.role === "Heal";
    default: return who.role === "DPS" && dpsType(who.cls, who.spec) === line.for;
  }
}

/* ---------- Fiches de boss ---------- */

export interface BossRow {
  /** Intitulé libre : « Tank principal », « Décurse », « Fils de la flamme »… */
  label: string;
  /** Persos du groupe chargés de cette tâche. */
  characterIds: string[];
  /** Ou une consigne en texte (« Groupes 3 et 4, côté gauche »). */
  text: string;
}
export interface BossSheet {
  /** Nom du boss (anglais pour les raids connus, libre pour les nouveaux raids de Forever). */
  name: string;
  /** Rencontre du jeu (ENCOUNTER_START) et PNJ à cibler : servent à l'addon pour reconnaître le boss. */
  encounterId: number | null;
  npcIds: number[];
  rows: BossRow[];
}

export interface RaidPrep {
  /** Instance connue (clé de RAID_INSTANCES) dont on propose les boss ; null : boss saisis à la main. */
  instance: string | null;
  consumables: ConsumableLine[];
  bosses: BossSheet[];
}
export const EMPTY_PREP: RaidPrep = { instance: null, consumables: [], bosses: [] };

export const PREP_LIMITS = { consumables: 30, bosses: 30, rows: 12, label: 40, text: 120, characters: 10 } as const;

interface BossDef { name: string; encounterId: number; npcIds: number[] }
export interface RaidInstance { key: string; name: string; aliases: string[]; bosses: BossDef[] }
const b = (name: string, encounterId: number, ...npcIds: number[]): BossDef => ({ name, encounterId, npcIds });

/**
 * Raids connus (Classic) : boss dans l'ordre habituel, rencontre du jeu et PNJ. Les nouveaux raids de Forever se
 * saisissent à la main ; l'addon apprend leurs PNJ au premier combat (et corrige ces identifiants s'ils diffèrent).
 */
export const RAID_INSTANCES: RaidInstance[] = [
  { key: "mc", name: "Molten Core", aliases: ["mc", "molten core", "coeur du magma"], bosses: [
    b("Lucifron", 663, 12118), b("Magmadar", 664, 11982), b("Gehennas", 665, 12259), b("Garr", 666, 12057), b("Baron Geddon", 668, 12056),
    b("Shazzrah", 667, 12264), b("Sulfuron Harbinger", 669, 12098), b("Golemagg the Incinerator", 670, 11988), b("Majordomo Executus", 671, 12018), b("Ragnaros", 672, 11502)] },
  { key: "ony", name: "Onyxia's Lair", aliases: ["ony", "onyxia", "onyxia s lair", "repaire d onyxia"], bosses: [b("Onyxia", 1084, 10184)] },
  { key: "bwl", name: "Blackwing Lair", aliases: ["bwl", "blackwing lair", "repaire de l aile noire", "aile noire"], bosses: [
    b("Razorgore the Untamed", 610, 12435), b("Vaelastrasz the Corrupt", 611, 13020), b("Broodlord Lashlayer", 612, 12017), b("Firemaw", 613, 11983),
    b("Ebonroc", 614, 14601), b("Flamegor", 615, 11981), b("Chromaggus", 616, 14020), b("Nefarian", 617, 11583, 10162)] },
  { key: "zg", name: "Zul'Gurub", aliases: ["zg", "zul gurub"], bosses: [
    b("High Priestess Jeklik", 785, 14517), b("High Priest Venoxis", 784, 14507), b("High Priestess Mar'li", 786, 14510), b("Bloodlord Mandokir", 787, 11382),
    b("Edge of Madness", 788, 15082, 15083, 15084, 15085), b("High Priest Thekal", 789, 14509), b("Gahz'ranka", 790, 15114),
    b("High Priestess Arlokk", 791, 14515), b("Jin'do the Hexxer", 792, 11380), b("Hakkar", 793, 14834)] },
  { key: "aq20", name: "Ruins of Ahn'Qiraj", aliases: ["aq20", "aq 20", "ruins of ahn qiraj", "ruines d ahn qiraj"], bosses: [
    b("Kurinnaxx", 718, 15348), b("General Rajaxx", 719, 15341), b("Moam", 720, 15340), b("Buru the Gorger", 721, 15370), b("Ayamiss the Hunter", 722, 15369), b("Ossirian the Unscarred", 723, 15339)] },
  { key: "aq40", name: "Temple of Ahn'Qiraj", aliases: ["aq40", "aq 40", "temple of ahn qiraj", "temple d ahn qiraj"], bosses: [
    b("The Prophet Skeram", 709, 15263), b("Silithid Royalty", 710, 15544, 15543, 15511), b("Battleguard Sartura", 711, 15516), b("Fankriss the Unyielding", 712, 15510),
    b("Viscidus", 713, 15299), b("Princess Huhuran", 714, 15509), b("Twin Emperors", 715, 15276, 15275), b("Ouro", 716, 15517), b("C'Thun", 717, 15727, 15589)] },
  { key: "naxx", name: "Naxxramas", aliases: ["naxx", "naxxramas"], bosses: [
    b("Anub'Rekhan", 1107, 15956), b("Grand Widow Faerlina", 1110, 15953), b("Maexxna", 1116, 15952), b("Noth the Plaguebringer", 1117, 15954),
    b("Heigan the Unclean", 1112, 15936), b("Loatheb", 1115, 16011), b("Instructor Razuvious", 1113, 16061), b("Gothik the Harvester", 1109, 16060),
    b("The Four Horsemen", 1121, 16064, 16062, 16063, 16065), b("Patchwerk", 1118, 16028), b("Grobbulus", 1111, 15931), b("Gluth", 1108, 15932),
    b("Thaddius", 1120, 15928, 15929, 15930), b("Sapphiron", 1119, 15989), b("Kel'Thuzad", 1114, 15990)] },
];

/** Instance connue reconnue dans le nom d'un raid (« MC semaine 3 », « Cœur du Magma » → mc). */
export function instanceOf(raidName: string): string | null {
  const k = ` ${instanceKey(raidName)} `;
  let best: { key: string; len: number } | null = null;
  for (const inst of RAID_INSTANCES) {
    for (const a of inst.aliases) {
      if (k.includes(` ${a} `) && (!best || a.length > best.len)) best = { key: inst.key, len: a.length };
    }
  }
  return best?.key ?? null;
}

/** Fiche vide d'un boss connu (pour l'afficher avant qu'elle soit remplie). */
export function knownBosses(instance: string | null): BossSheet[] {
  const inst = RAID_INSTANCES.find(i => i.key === instance);
  return (inst?.bosses ?? []).map(x => ({ name: x.name, encounterId: x.encounterId, npcIds: x.npcIds, rows: [] }));
}

/** Clé de comparaison d'un nom de boss (casse, accents, ponctuation). */
export const bossKey = (name: string) => instanceKey(name);
