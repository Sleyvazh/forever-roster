import { PROFESSION_SKILL_LINES, SECONDARY_PROFESSIONS } from "@forever/game-data";
import type { Professions } from "../db/schema";

/** Lignes de compétence des métiers actuels d'un perso (deux principaux + secondaires). */
export const currentLines = (p: Professions) => new Set(
  [p.prof1.name, p.prof2.name, ...Object.values(SECONDARY_PROFESSIONS).map(s => s.name)].filter(Boolean).map(n => PROFESSION_SKILL_LINES[n]),
);

/** Nom du métier à partir de sa ligne de compétence. */
export const professionOf = (skillLine: number) =>
  Object.entries(PROFESSION_SKILL_LINES).find(([, l]) => l === skillLine)?.[0] ?? "Métier";
