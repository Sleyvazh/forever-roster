/**
 * Collage d'un export de l'addon (Ctrl+V n'importe où) : choix de la fiche de chaque perso, puis application côté
 * serveur (lot K1, POST /api/addon/import, la même logique que Roster Companion). L'objectif BiS, les intitulés de spé,
 * l'off-spec et les notes ne sont jamais touchés.
 */
import { addonKeyOf, IMPORT_PARTS, sameCharacter, type CharacterExport, type ImportPart, type ImportResult } from "@forever/game-data";
import { post, type Character } from "./api";
import { N, t, tn } from "./i18n";

export type Part = ImportPart;
const PART_LABEL: Record<Part, string> = {
  identity: N("Niveau, race et classe"), gear: N("Équipement porté"), professions: N("Métiers"),
  recipes: N("Patrons connus et recherchés"), talents: N("Talents"), signups: N("Inscriptions aux raids"),
};
/** Les parties d'un import et leur libellé français (à traduire à l'affichage : t(label)). */
export const PARTS: [Part, string][] = IMPORT_PARTS.map(k => [k, PART_LABEL[k]]);
export const ALL_PARTS = new Set<Part>(IMPORT_PARTS);


/** Fiche choisie pour un perso du jeu : id d'une fiche, « new » (la créer) ou « skip » (l'ignorer). */
export type Target = string;
export const blockKey = addonKeyOf;

/** Anciens choix gardés dans ce navigateur (avant le lot K1) : lus une dernière fois, le serveur retient désormais le lien. */
function legacyChoice(key: string): string | undefined {
  try { return (JSON.parse(localStorage.getItem("fr-addon-fiches") ?? "{}") as Record<string, string>)[key]; } catch { return undefined; }
}

/**
 * Fiche proposée : celle qui porte le GUID du perso (addon 1.6.2, le prénom peut exister deux fois), sinon celle déjà liée
 * à ce perso du jeu, sinon même prénom et même classe, sinon une nouvelle fiche.
 */
export function guessTarget(d: CharacterExport, mine: Character[]): Target {
  if (d.guid) { const same = mine.find(c => c.guid === d.guid); if (same) return same.id; }
  const key = blockKey(d);
  const fits = (c: Character) => !c.cls || !d.cls || c.cls === d.cls;
  const linked = mine.find(c => c.addonKey === key && (!d.guid || !c.guid));
  if (linked) return linked.id;
  const saved = legacyChoice(key);
  if (saved && mine.some(c => c.id === saved && fits(c))) return saved;
  return mine.find(c => !c.addonKey && !c.guid && sameCharacter(d.name, c.name) && fits(c))?.id ?? "new";
}

/** Résultat montré : réussi, refusé, ou seulement une information (relevé de guilde à lier, d'une autre guilde). */
export interface ApplyResult { name: string; ok: boolean | null; msg: string; groups?: { id: string; name: string }[] }

/** Persos sur leur fiche, bilans de raid, puis relevé de la guilde du jeu : tout part en une requête, le serveur applique. */
export async function importOnServer(text: string, targets: Record<string, Target>, parts: Set<Part>, skipLogs: string[], skipGuild = false): Promise<ApplyResult[]> {
  const r = await post<{ results: ImportResult[]; errors: string[] }>("/addon/import", { text, targets, parts: [...parts], skipLogs, ...(skipGuild && { skipGuild }) });
  return r.results.filter(x => x.status !== "skipped").map(x => ({
    name: x.name, msg: x.message, groups: x.groups,
    ok: x.status === "created" || x.status === "updated" ? true : x.kind === "guild" && x.status === "ignored" ? null : false,
  }));
}

/** Résumé court d'un bloc (ce que l'export apporte). */
export function blockSummary(d: CharacterExport) {
  const parts = [t("niv. {n}", { n: d.level })];
  const gear = Object.keys(d.gear).length;
  if (gear) parts.push(tn(gear, "{n} pièce", "{n} pièces"));
  if (d.recipes.length) parts.push(tn(d.recipes.length, "{n} patron", "{n} patrons"));
  if (d.talents.length) parts.push(t("{n} pts de talents", { n: d.talents.reduce((a, x) => a + x.rank, 0) }));
  if (d.signups.length) parts.push(tn(d.signups.length, "{n} inscription", "{n} inscriptions"));
  if (d.wanted.length) parts.push(tn(d.wanted.length, "{n} recherché", "{n} recherchés"));
  return parts.join(" · ");
}

/** « il y a 2 h », « hier », « il y a 9 jours » ; stale : plus d'une semaine. */
export function syncAge(at?: string | null) {
  if (!at) return { text: t("jamais synchronisé"), stale: true };
  const h = (Date.now() - new Date(at).getTime()) / 3600_000;
  if (h < 1) return { text: t("synchro il y a moins d'une heure"), stale: false };
  if (h < 24) return { text: t("synchro il y a {n} h", { n: Math.floor(h) }), stale: false };
  const d = Math.floor(h / 24);
  return { text: d === 1 ? t("synchro hier") : t("synchro il y a {n} jours", { n: d }), stale: d > 7 };
}
