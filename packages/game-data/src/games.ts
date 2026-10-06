import { CLASSES, CLASS_NAMES, MAX_LEVEL, isValidSpec, type ClassName } from "./core";
import { RAID_EFFECTS, type RaidEffect } from "./raid";
import { RETAIL_CLASSES, RETAIL_CLASS_NAMES, RETAIL_EFFECTS, RETAIL_MAX_LEVEL, retailSpec, type GameLang, type GameLangPref } from "./retail";
import type { Game } from "./site";

/**
 * Données selon le jeu (un site, deux adresses) : Forever Roster garde les données de WoW Forever (en anglais),
 * Roster celles de WoW Retail, avec les noms en français ou en anglais selon le choix de chacun.
 */

export const classesOf = (game: Game): string[] => (game === "retail" ? RETAIL_CLASS_NAMES : CLASS_NAMES);
export const isClassOf = (game: Game, cls: string) => classesOf(game).includes(cls);
export function specsOf(game: Game, cls: string): string[] {
  if (game === "retail") return RETAIL_CLASSES[cls]?.specs.map(s => s.name) ?? [];
  return [...(CLASSES[cls as ClassName]?.specs ?? [])];
}
export const isValidSpecFor = (game: Game, cls: string, spec: string) => (game === "retail" ? !!retailSpec(cls, spec) : isValidSpec(cls, spec));
export const maxLevelOf = (game: Game) => (game === "retail" ? RETAIL_MAX_LEVEL : MAX_LEVEL);
export const effectsOf = (game: Game): RaidEffect[] => (game === "retail" ? RETAIL_EFFECTS : RAID_EFFECTS);

/** Couleur de classe ; sans jeu précisé, celle de Forever puis celle de Retail (classes propres à Retail). */
export function classColor(cls: string, game?: Game): string | undefined {
  if (game === "retail") return RETAIL_CLASSES[cls]?.color;
  return CLASSES[cls as ClassName]?.color ?? (game ? undefined : RETAIL_CLASSES[cls]?.color);
}
/** Nom de classe affiché : Retail en français ou en anglais ; Forever tel quel (données en anglais). */
export function classLabel(game: Game, cls: string, lang: GameLang): string {
  if (game === "retail" && lang === "fr") return RETAIL_CLASSES[cls]?.fr ?? cls;
  return cls;
}
export function specLabel(game: Game, cls: string, spec: string, lang: GameLang): string {
  if (game === "retail" && lang === "fr") return retailSpec(cls, spec)?.fr ?? spec;
  return spec;
}
/** Langue des noms du jeu : le choix de la personne, sinon celle du navigateur (français ou anglais). */
export function resolveGameLang(pref: GameLangPref | null | undefined, browserLang?: string | null): GameLang {
  if (pref === "fr" || pref === "en") return pref;
  return (browserLang ?? "fr").toLowerCase().startsWith("fr") ? "fr" : "en";
}
