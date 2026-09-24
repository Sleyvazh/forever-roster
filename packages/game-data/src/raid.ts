import { roleOf, type ClassName, type Role } from "./core";

/**
 * Buffs, auras et debuffs de raid, sur la base de WoW Classic.
 * WoW Forever modifie 747 talents et sorts : ces règles sont un point de départ
 * à ajuster au fil des changements publiés (https://foreverchanges.pro/changes).
 */

export type EffectKind = "buff" | "aura" | "debuff" | "utility";
/** raid = une seule source suffit pour tout le raid ; party = il faut une source dans chaque groupe de 5. */
export type EffectScope = "raid" | "party";

export interface Provider { cls: ClassName; specs?: string[] }
export interface RaidEffect {
  id: string;
  name: string;
  kind: EffectKind;
  scope: EffectScope;
  providers: Provider[];
  note?: string;
  /** Effets qui s'excluent : une même source ne peut en fournir qu'un seul (bénédictions, malédictions…). */
  exclusiveGroup?: string;
}

const any = (cls: ClassName, specs?: string[]): Provider => (specs ? { cls, specs } : { cls });

export const RAID_EFFECTS: RaidEffect[] = [
  // Buffs de raid
  { id: "fort", name: "Power Word: Fortitude", kind: "buff", scope: "raid", providers: [any("Priest")] },
  { id: "spirit", name: "Divine Spirit", kind: "buff", scope: "raid", providers: [any("Priest", ["Discipline"])], note: "Talent Discipline." },
  { id: "shadowprot", name: "Shadow Protection", kind: "buff", scope: "raid", providers: [any("Priest")] },
  { id: "motw", name: "Mark of the Wild", kind: "buff", scope: "raid", providers: [any("Druid")] },
  { id: "ai", name: "Arcane Intellect", kind: "buff", scope: "raid", providers: [any("Mage")] },
  { id: "kings", name: "Blessing of Kings", kind: "buff", scope: "raid", providers: [any("Paladin", ["Protection"])], exclusiveGroup: "blessing", note: "Talent Protection. Une bénédiction par paladin et par classe." },
  { id: "might", name: "Blessing of Might", kind: "buff", scope: "raid", providers: [any("Paladin")], exclusiveGroup: "blessing" },
  { id: "wisdom", name: "Blessing of Wisdom", kind: "buff", scope: "raid", providers: [any("Paladin")], exclusiveGroup: "blessing" },
  { id: "salv", name: "Blessing of Salvation", kind: "buff", scope: "raid", providers: [any("Paladin")], exclusiveGroup: "blessing" },
  { id: "light", name: "Blessing of Light", kind: "buff", scope: "raid", providers: [any("Paladin")], exclusiveGroup: "blessing" },

  // Buffs et auras de groupe (5 joueurs)
  { id: "bshout", name: "Battle Shout", kind: "aura", scope: "party", providers: [any("Warrior")] },
  { id: "tsa", name: "Trueshot Aura", kind: "aura", scope: "party", providers: [any("Hunter", ["Marksmanship"])], note: "Talent Marksmanship." },
  { id: "lotp", name: "Leader of the Pack", kind: "aura", scope: "party", providers: [any("Druid", ["Feral Cat", "Feral Bear"])], note: "Talent Feral." },
  { id: "moonkin", name: "Moonkin Aura", kind: "aura", scope: "party", providers: [any("Druid", ["Balance"])], note: "Talent Balance." },
  { id: "wf", name: "Windfury Totem", kind: "aura", scope: "party", providers: [any("Shaman")], exclusiveGroup: "air-totem" },
  { id: "goa", name: "Grace of Air Totem", kind: "aura", scope: "party", providers: [any("Shaman")], exclusiveGroup: "air-totem" },
  { id: "soe", name: "Strength of Earth Totem", kind: "aura", scope: "party", providers: [any("Shaman")] },
  { id: "manaspring", name: "Mana Spring Totem", kind: "aura", scope: "party", providers: [any("Shaman")] },
  { id: "bloodpact", name: "Blood Pact (Imp)", kind: "aura", scope: "party", providers: [any("Warlock")] },
  { id: "devo", name: "Devotion Aura", kind: "aura", scope: "party", providers: [any("Paladin")], exclusiveGroup: "pally-aura" },
  { id: "conc", name: "Concentration Aura", kind: "aura", scope: "party", providers: [any("Paladin")], exclusiveGroup: "pally-aura" },

  // Debuffs sur la cible
  { id: "sunder", name: "Sunder Armor", kind: "debuff", scope: "raid", providers: [any("Warrior")] },
  { id: "expose", name: "Expose Armor", kind: "debuff", scope: "raid", providers: [any("Rogue")], note: "Remplace Sunder Armor s'il est amélioré." },
  { id: "ff", name: "Faerie Fire", kind: "debuff", scope: "raid", providers: [any("Druid")] },
  { id: "cor", name: "Curse of Recklessness", kind: "debuff", scope: "raid", providers: [any("Warlock")], exclusiveGroup: "curse" },
  { id: "coe", name: "Curse of the Elements", kind: "debuff", scope: "raid", providers: [any("Warlock")], exclusiveGroup: "curse" },
  { id: "cos", name: "Curse of Shadow", kind: "debuff", scope: "raid", providers: [any("Warlock")], exclusiveGroup: "curse" },
  { id: "scorch", name: "Improved Scorch", kind: "debuff", scope: "raid", providers: [any("Mage", ["Fire"])], note: "Talent Fire." },
  { id: "wc", name: "Winter's Chill", kind: "debuff", scope: "raid", providers: [any("Mage", ["Frost"])], note: "Talent Frost." },
  { id: "sw", name: "Shadow Weaving", kind: "debuff", scope: "raid", providers: [any("Priest", ["Shadow"])], note: "Talent Shadow." },
  { id: "jow", name: "Judgement of Wisdom", kind: "debuff", scope: "raid", providers: [any("Paladin")], exclusiveGroup: "judgement" },
  { id: "jol", name: "Judgement of Light", kind: "debuff", scope: "raid", providers: [any("Paladin")], exclusiveGroup: "judgement" },
  { id: "jotc", name: "Judgement of the Crusader", kind: "debuff", scope: "raid", providers: [any("Paladin")], exclusiveGroup: "judgement" },
  { id: "hmark", name: "Hunter's Mark", kind: "debuff", scope: "raid", providers: [any("Hunter")] },
  { id: "demo", name: "Demoralizing Shout / Roar", kind: "debuff", scope: "raid", providers: [any("Warrior"), any("Druid", ["Feral Bear"])] },
  { id: "tclap", name: "Thunder Clap", kind: "debuff", scope: "raid", providers: [any("Warrior")] },
  { id: "stormstrike", name: "Stormstrike", kind: "debuff", scope: "raid", providers: [any("Shaman", ["Enhancement"])], note: "Talent Enhancement." },

  // Utilitaires
  { id: "brez", name: "Rebirth (rez en combat)", kind: "utility", scope: "raid", providers: [any("Druid")] },
  { id: "innervate", name: "Innervate", kind: "utility", scope: "raid", providers: [any("Druid")] },
  { id: "soulstone", name: "Soulstone", kind: "utility", scope: "raid", providers: [any("Warlock")] },
  { id: "pi", name: "Power Infusion", kind: "utility", scope: "raid", providers: [any("Priest", ["Discipline"])], note: "Talent Discipline." },
  { id: "tremor", name: "Tremor Totem", kind: "utility", scope: "party", providers: [any("Shaman")] },
];

export const RAID_GROUPS = 8;
export const GROUP_SIZE = 5;

export interface RaidMember { characterId: string; cls: string; spec: string | null; group: number }

export interface EffectCoverage {
  effect: RaidEffect;
  /** Nombre de sources dans le raid. */
  sources: number;
  /** Pour les effets de groupe : groupes non vides sans source. */
  missingGroups: number[];
  covered: boolean;
}

function provides(effect: RaidEffect, m: RaidMember): boolean {
  return effect.providers.some(p => p.cls === m.cls && (!p.specs || (m.spec !== null && p.specs.includes(m.spec))));
}

/** Calcule la couverture des buffs/debuffs pour une composition de raid. */
export function computeCoverage(members: RaidMember[]): EffectCoverage[] {
  const occupied = [...new Set(members.map(m => m.group))].sort((a, b) => a - b);
  return RAID_EFFECTS.map(effect => {
    const sources = members.filter(m => provides(effect, m));
    if (effect.scope === "raid") {
      return { effect, sources: sources.length, missingGroups: [], covered: sources.length > 0 };
    }
    const groupsWith = new Set(sources.map(s => s.group));
    const missingGroups = occupied.filter(g => !groupsWith.has(g));
    return { effect, sources: sources.length, missingGroups, covered: occupied.length > 0 && missingGroups.length === 0 };
  });
}

/**
 * Pour les effets exclusifs (bénédictions, malédictions, jugements…), une source n'en fournit qu'un.
 * Renvoie, par groupe d'exclusivité, le nombre de sources disponibles et le nombre d'effets demandés.
 */
export function exclusiveBudget(members: RaidMember[]): { group: string; available: number; wanted: number }[] {
  const groups = new Map<string, RaidEffect[]>();
  for (const e of RAID_EFFECTS) if (e.exclusiveGroup) groups.set(e.exclusiveGroup, [...(groups.get(e.exclusiveGroup) ?? []), e]);
  return [...groups.entries()].map(([group, effects]) => {
    const providerClasses = new Set(effects.flatMap(e => e.providers.map(p => p.cls)));
    const available = members.filter(m => providerClasses.has(m.cls as ClassName)).length;
    return { group, available, wanted: effects.length };
  });
}

export function roleCounts(members: { spec: string | null }[]): Record<Role | "?", number> {
  const out: Record<Role | "?", number> = { Tank: 0, Heal: 0, DPS: 0, "?": 0 };
  for (const m of members) out[roleOf(m.spec) ?? "?"]++;
  return out;
}
