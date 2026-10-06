/**
 * Collage d'un export de l'addon (Ctrl+V n'importe où) : choix de la fiche de chaque perso, puis application côté
 * serveur (lot K1, POST /api/addon/import, la même logique que Roster Companion). L'objectif BiS, les intitulés de spé,
 * l'off-spec et les notes ne sont jamais touchés.
 */
import { addonKeyOf, IMPORT_PARTS, sameCharacter, type CharacterExport, type ImportPart, type ImportResult } from "@forever/game-data";
import { post, type Character } from "./api";

export type Part = ImportPart;
const PART_LABEL: Record<Part, string> = {
  identity: "Niveau, race et classe", gear: "Équipement porté", professions: "Métiers",
  recipes: "Patrons connus et recherchés", talents: "Talents", signups: "Inscriptions aux raids",
};
export const PARTS: [Part, string][] = IMPORT_PARTS.map(k => [k, PART_LABEL[k]]);
export const ALL_PARTS = new Set<Part>(IMPORT_PARTS);

const plural = (n: number, w: string) => `${n} ${w}${n > 1 ? "s" : ""}`;

/** Fiche choisie pour un perso du jeu : id d'une fiche, « new » (la créer) ou « skip » (l'ignorer). */
export type Target = string;
export const blockKey = addonKeyOf;

/** Anciens choix gardés dans ce navigateur (avant le lot K1) : lus une dernière fois, le serveur retient désormais le lien. */
function legacyChoice(key: string): string | undefined {
  try { return (JSON.parse(localStorage.getItem("fr-addon-fiches") ?? "{}") as Record<string, string>)[key]; } catch { return undefined; }
}

/** Fiche proposée : celle déjà liée à ce perso du jeu, sinon même prénom et même classe, sinon une nouvelle fiche. */
export function guessTarget(d: CharacterExport, mine: Character[]): Target {
  const key = blockKey(d);
  const fits = (c: Character) => !c.cls || !d.cls || c.cls === d.cls;
  const linked = mine.find(c => c.addonKey === key);
  if (linked) return linked.id;
  const saved = legacyChoice(key);
  if (saved && mine.some(c => c.id === saved && fits(c))) return saved;
  return mine.find(c => !c.addonKey && sameCharacter(d.name, c.name) && fits(c))?.id ?? "new";
}

export interface ApplyResult { name: string; ok: boolean; msg: string }

/** Persos sur leur fiche, puis bilans de raid : tout part en une requête, le serveur applique. */
export async function importOnServer(text: string, targets: Record<string, Target>, parts: Set<Part>, skipLogs: string[]): Promise<ApplyResult[]> {
  const r = await post<{ results: ImportResult[]; errors: string[] }>("/addon/import", { text, targets, parts: [...parts], skipLogs });
  return r.results.filter(x => x.status !== "skipped").map(x => ({ name: x.name, ok: x.status === "created" || x.status === "updated", msg: x.message }));
}

/** Résumé court d'un bloc (ce que l'export apporte). */
export function blockSummary(d: CharacterExport) {
  const parts = [`niv. ${d.level}`];
  const gear = Object.keys(d.gear).length;
  if (gear) parts.push(plural(gear, "pièce"));
  if (d.recipes.length) parts.push(plural(d.recipes.length, "patron"));
  if (d.talents.length) parts.push(`${d.talents.reduce((a, t) => a + t.rank, 0)} pts de talents`);
  if (d.signups.length) parts.push(plural(d.signups.length, "inscription"));
  if (d.wanted.length) parts.push(`${d.wanted.length} recherché${d.wanted.length > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

/** « il y a 2 h », « hier », « il y a 9 jours » ; stale : plus d'une semaine. */
export function syncAge(at?: string | null) {
  if (!at) return { text: "jamais synchronisé", stale: true };
  const h = (Date.now() - new Date(at).getTime()) / 3600_000;
  if (h < 1) return { text: "synchro il y a moins d'une heure", stale: false };
  if (h < 24) return { text: `synchro il y a ${Math.floor(h)} h`, stale: false };
  const d = Math.floor(h / 24);
  return { text: d === 1 ? "synchro hier" : `synchro il y a ${d} jours`, stale: d > 7 };
}
