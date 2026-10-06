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

/** Talent d'un arbre de Forever, tel que le lien du calculateur le range (ordre linkIndex). */
export interface LinkTalent { id: number; tree: number; linkIndex: number; maxRank: number }

/**
 * Talents pris en jeu (rang par nœud, export de l'addon) → lien du calculateur et répartition (« 9/37/5 »).
 * Null si la classe est inconnue ou si aucun point n'est placé.
 */
export function linkFromRanks(cls: string, talents: LinkTalent[], ranks: Map<number, number>) {
  const slug = CLASSES[cls as ClassName]?.slug;
  if (!slug) return null;
  const blocks = [0, 1, 2].map(tree => {
    const list = talents.filter(t => t.tree === tree);
    const digits = Array.from({ length: Math.max(0, ...list.map(t => t.linkIndex + 1)) }, () => 0);
    for (const t of list) digits[t.linkIndex] = Math.min(t.maxRank, ranks.get(t.id) ?? 0);
    return digits.join("").replace(/0+$/, "");
  });
  const points = blocks.map(b => [...b].reduce((a, d) => a + Number(d), 0));
  if (!points.some(Boolean)) return null;
  return { link: `https://foreverchanges.pro/talents/${slug}?b=${blocks.join("-").replace(/-+$/, "")}`, split: points.join("/") };
}
