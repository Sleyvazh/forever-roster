import {
  CLASS_NAMES, CLASSES, GEAR_SLOTS, isClassOf, isValidCombo, isValidSpecFor, LEGACY_TREES, maxLevelOf, PRIMARY_PROFESSIONS, RACE_NAMES, RETAIL_CLASS_NAMES,
  type Game,
} from "@forever/game-data";
import { z } from "zod";
import { msg, type Msg } from "./i18n";

const shortText = (max: number) => z.string().trim().max(max);
const prof = z.object({ name: z.union([z.literal(""), z.enum(Object.keys(PRIMARY_PROFESSIONS) as [string, ...string[]])]), skill: z.int().min(0).max(300) });
const skill = z.int().min(0).max(300);

/** N'accepte que des liens https : empêche d'enregistrer un lien javascript: qui serait cliqué par un autre joueur. */
const httpsUrl = z.union([z.literal(""), z.url({ protocol: /^https$/ }).max(500)]);

const talentSplit = z.union([z.literal(""), z.string().regex(/^\d{1,2}\/\d{1,2}\/\d{1,2}$/, "format attendu : 9/37/5")]);

const gearEntry = z.object({
  cur: shortText(100).optional(),
  curId: z.int().positive().nullable().optional(),
  q: z.int().min(0).max(7).nullable().optional(),
  bis: shortText(100).optional(),
  bisId: z.int().positive().nullable().optional(),
  bisQ: z.int().min(0).max(7).nullable().optional(),
  got: z.boolean().optional(),
});
const perk = z.object({ name: shortText(60), rank: z.int().min(0).max(10), max: z.int().min(1).max(10) });

export const characterFields = z.object({
  name: shortText(40).min(1),
  /** Royaume (Roster, WoW Retail). */
  realm: shortText(40),
  race: z.union([z.literal(""), z.enum(RACE_NAMES as [string, ...string[]])]),
  // Classes des deux jeux ; crossCheck vérifie que la classe est bien celle du jeu de l'adresse
  cls: z.union([z.literal(""), z.enum([...new Set([...CLASS_NAMES, ...RETAIL_CLASS_NAMES])] as [string, ...string[]])]),
  spec1: shortText(20),
  spec2: shortText(20),
  level: z.int().min(1).max(90),
  talents: talentSplit,
  talentLink: httpsUrl,
  talents2: talentSplit,
  talentLink2: httpsUrl,
  professions: z.object({ prof1: prof, prof2: prof, cooking: skill, fishing: skill, firstAid: skill }),
  gear: z.partialRecord(z.enum(GEAR_SLOTS), gearEntry),
  legacy: z.partialRecord(z.enum(LEGACY_TREES.map(t => t.key) as [string, ...string[]]), z.array(perk).max(30)),
  notes: z.string().max(5000),
  /** Talents lus en jeu par l'addon (positions et rangs dans l'arbre de Forever). */
  talentNodes: z.array(z.object({
    id: z.int().min(0), rank: z.int().min(0).max(20), max: z.int().min(0).max(20), x: z.int().min(-100000).max(100000), y: z.int().min(-100000).max(100000),
    spell: z.int().min(0), sub: z.int().min(0), tree: z.int().min(0),
  })).max(500).nullable(),
});

export type CharacterInput = z.infer<typeof characterFields>;

/**
 * Règles qui dépendent de plusieurs champs et du jeu : combinaisons race/classe et talents de Forever ;
 * sur Roster (WoW Retail), classe de Retail, royaume obligatoire, pas de race (fiche légère).
 */
export function crossCheck(c: Partial<CharacterInput> & { race: string; cls: string; spec1: string; spec2: string; talents: string; talents2?: string }, game: Game = "forever"): Msg | null {
  if (c.cls && !isClassOf(game, c.cls)) return msg("{cls} n'est pas une classe de {game}.", { cls: c.cls, game: game === "retail" ? "WoW Retail" : "WoW Forever" });
  if (c.level !== undefined && c.level > maxLevelOf(game)) return msg("Niveau {n} au plus.", { n: maxLevelOf(game) });
  if (game === "retail") {
    if (!c.realm?.trim()) return msg("Indique le royaume du perso.");
    if (c.race) return msg("Pas de race sur les persos de Roster.");
  } else if (c.race && c.cls && !isValidCombo(c.race, c.cls)) return msg("{race} ne peut pas être {cls} dans WoW Forever.", { race: c.race, cls: c.cls });
  for (const s of [c.spec1, c.spec2]) {
    if (s && !c.cls) return msg("La spé « {spec} » n'existe pas pour cette classe.", { spec: s });
    if (s && !isValidSpecFor(game, c.cls, s)) return msg("La spé « {spec} » n'existe pas pour {cls}.", { spec: s, cls: c.cls });
  }
  for (const t of [c.talents, c.talents2]) {
    if (t && t.split("/").reduce((a, n) => a + Number(n), 0) > 51) return msg("Un build ne peut pas dépasser 51 points de talents.");
  }
  return null;
}

export const DEFAULT_CLASS_SPECS = Object.fromEntries(CLASS_NAMES.map(c => [c, CLASSES[c].specs]));
