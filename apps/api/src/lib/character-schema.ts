import {
  CLASS_NAMES, CLASSES, GEAR_SLOTS, isValidCombo, isValidSpec, LEGACY_TREES, PRIMARY_PROFESSIONS, RACE_NAMES,
} from "@forever/game-data";
import { z } from "zod";

const shortText = (max: number) => z.string().trim().max(max);
const prof = z.object({ name: z.union([z.literal(""), z.enum(Object.keys(PRIMARY_PROFESSIONS) as [string, ...string[]])]), skill: z.int().min(0).max(300) });
const skill = z.int().min(0).max(300);

/** N'accepte que des liens https : empêche d'enregistrer un lien javascript: qui serait cliqué par un autre joueur. */
const httpsUrl = z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(500)]);

const talentSplit = z.union([z.literal(""), z.string().regex(/^\d{1,2}\/\d{1,2}\/\d{1,2}$/, "format attendu : 9/37/5")]);

const gearEntry = z.object({
  cur: shortText(100).optional(),
  q: z.int().min(0).max(5).nullable().optional(),
  bis: shortText(100).optional(),
  got: z.boolean().optional(),
});
const perk = z.object({ name: shortText(60), rank: z.int().min(0).max(10), max: z.int().min(1).max(10) });

export const characterFields = z.object({
  name: shortText(40).min(1),
  race: z.union([z.literal(""), z.enum(RACE_NAMES as [string, ...string[]])]),
  cls: z.union([z.literal(""), z.enum(CLASS_NAMES as [string, ...string[]])]),
  spec1: shortText(20),
  spec2: shortText(20),
  level: z.int().min(1).max(60),
  talents: talentSplit,
  talentLink: httpsUrl,
  talents2: talentSplit,
  talentLink2: httpsUrl,
  professions: z.object({ prof1: prof, prof2: prof, cooking: skill, fishing: skill, firstAid: skill }),
  gear: z.partialRecord(z.enum(GEAR_SLOTS), gearEntry),
  legacy: z.partialRecord(z.enum(LEGACY_TREES.map(t => t.key) as [string, ...string[]]), z.array(perk).max(30)),
  notes: z.string().max(5000),
});

export type CharacterInput = z.infer<typeof characterFields>;

/** Règles qui dépendent de plusieurs champs (combinaisons race/classe de Forever, spés de la classe, total de talents). */
export function crossCheck(c: Partial<CharacterInput> & { race: string; cls: string; spec1: string; spec2: string; talents: string; talents2?: string }): string | null {
  if (c.race && c.cls && !isValidCombo(c.race, c.cls)) return `${c.race} ne peut pas être ${c.cls} dans WoW Forever.`;
  for (const s of [c.spec1, c.spec2]) {
    if (s && (!c.cls || !isValidSpec(c.cls, s))) return `La spé « ${s} » n'existe pas pour ${c.cls || "cette classe"}.`;
  }
  for (const t of [c.talents, c.talents2]) {
    if (t && t.split("/").reduce((a, n) => a + Number(n), 0) > 51) return "Un build ne peut pas dépasser 51 points de talents.";
  }
  return null;
}

export const DEFAULT_CLASS_SPECS = Object.fromEntries(CLASS_NAMES.map(c => [c, CLASSES[c].specs]));
