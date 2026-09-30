/**
 * Liens du calculateur de talents ForeverChanges : https://foreverchanges.pro/talents/<classe>?b=<arbre1>-<arbre2>-<arbre3>
 * Chaque bloc donne un chiffre par talent de l'arbre (dans l'ordre du calculateur : palier par palier), sans les zéros de fin.
 * La répartition est la somme des chiffres de chaque bloc (ex. 050022-5520002123032213051-05 → 9/37/5).
 */
import { CLASSES, type ClassName } from "./core";

export type TalentLink =
  | { ok: true; cls: ClassName | null; points: [number, number, number]; blocks: [string, string, string]; split: string }
  | { ok: false; error: string };

export function parseTalentLink(input: string): TalentLink {
  let u: URL;
  try { u = new URL(input.trim()); } catch { return { ok: false, error: "Ce n'est pas une adresse valide : colle le lien complet copié depuis le calculateur." }; }
  if (u.protocol !== "https:" || !/(^|\.)foreverchanges\.pro$/.test(u.hostname)) {
    return { ok: false, error: "Seuls les liens du calculateur foreverchanges.pro/talents sont reconnus." };
  }
  const m = u.pathname.match(/^\/talents\/([a-z-]+)\/?$/);
  if (!m) return { ok: false, error: "Le lien doit pointer vers le calculateur de talents (…/talents/<classe>)." };
  const cls = (Object.keys(CLASSES) as ClassName[]).find(k => CLASSES[k].slug === m[1]) ?? null;
  const b = u.searchParams.get("b") ?? "";
  if (!/^[0-9]{0,40}(-[0-9]{0,40}){0,2}$/.test(b)) return { ok: false, error: "Le build contenu dans le lien est illisible." };
  const parts = b.split("-");
  const blocks = [parts[0] ?? "", parts[1] ?? "", parts[2] ?? ""] as [string, string, string];
  const points = blocks.map(s => [...s].reduce((a, d) => a + Number(d), 0)) as [number, number, number];
  return { ok: true, cls, points, blocks, split: points.join("/") };
}
