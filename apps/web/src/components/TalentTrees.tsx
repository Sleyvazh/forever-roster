import { CLASS_SPECS, CLASSES, type ClassName, type SpecDef } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "../api";
import { useGameVersion } from "./GameData";
import { SpecIcon } from "./Icons";
import { FloatingTip, iconUsable, useIconFailures } from "./ItemTooltip";

export type TreeView = "gauges" | "grid";
export interface Talent { id: number; tree: number; tier: number; col: number; linkIndex: number; maxRank: number; name: string; icon: string | null; prereq: number | null; description: string }

/** Arbres de talents de Forever d'une classe (système C_Traits du jeu), chargés une fois par version des données. */
export function useTalentData(cls: string, enabled = true) {
  const v = useGameVersion();
  return useQuery({
    queryKey: ["talents", cls, v], enabled: enabled && !!cls, staleTime: 60 * 60_000,
    queryFn: () => get<{ talents: Talent[] }>(`/gamedata/talents/${encodeURIComponent(cls)}?v=${v}`),
  });
}

/** Rangs d'un build : d'après le lien ForeverChanges (un chiffre par talent) ou l'export de l'addon (rang par nœud). */
export function ranksFrom(talents: Talent[], source: { blocks?: readonly string[] | null; nodes?: { id: number; rank: number }[] | null }) {
  const ranks = new Map<number, number>();
  if (source.blocks) {
    for (const t of talents) ranks.set(t.id, Number(source.blocks[t.tree]?.[t.linkIndex] ?? 0));
    // Un lien qui ne colle pas aux arbres (rang au-delà du maximum, trop de chiffres) n'est pas utilisé
    const fits = source.blocks.every((b, tree) => b.length <= talents.filter(t => t.tree === tree).length)
      && talents.every(t => (ranks.get(t.id) ?? 0) <= t.maxRank);
    return fits ? ranks : null;
  }
  if (source.nodes?.length) {
    const known = new Set(talents.map(t => t.id));
    for (const n of source.nodes) if (known.has(n.id)) ranks.set(n.id, n.rank);
    return ranks.size ? ranks : null;
  }
  return null;
}

/** Lien ForeverChanges et répartition reconstruits depuis des rangs par nœud (export de l'addon). */
export function linkFromRanks(cls: string, talents: Talent[], ranks: Map<number, number>) {
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

/** Icône d'un arbre : celle d'une spé de cet arbre (ex. Feral Combat → Feral Cat). */
function TreeIcon({ cls, tree, size }: { cls: string; tree: number; size: number }) {
  const spec = ((CLASS_SPECS as Record<string, readonly SpecDef[]>)[cls] ?? []).find(d => d.tree === tree);
  return spec ? <SpecIcon cls={cls} spec={spec.name} size={size} /> : <span className="ticon-empty" style={{ width: size, height: size }} />;
}

/**
 * Arbres de talents d'un build.
 * « gauges » : une ligne par arbre (jauge graduée par palier, repère du talent ultime).
 * « grid » : les vrais arbres de Forever, talent par talent, quand on connaît les rangs (lien ou addon).
 */
export function TalentTrees({ cls, points, mainTree, view = "gauges", ranks, talents }: {
  cls: string; points: number[]; mainTree?: number; view?: TreeView; ranks?: Map<number, number> | null; talents?: Talent[];
}) {
  const cl = CLASSES[cls as ClassName];
  if (!cl) return null;
  const top = points.indexOf(Math.max(...points));
  const grid = view === "grid" && !!ranks && !!talents?.length;
  return (
    <div className={`ttrees${grid ? " grid" : ""}`}>
      {cl.trees.map((name, i) => {
        const p = points[i] ?? 0;
        const main = mainTree === i || (mainTree === undefined && i === top && p > 0);
        if (grid) {
          return (
            <div key={name} className={`tt-col${main ? " main" : ""}`}>
              <div className="tt-colhead"><TreeIcon cls={cls} tree={i} size={18} /><span className="tt-name">{name}</span><b className="num tt-pts">{p}</b></div>
              <TreeGrid talents={talents!.filter(t => t.tree === i)} ranks={ranks!} spent={p} />
            </div>
          );
        }
        return (
          <div key={name} className={`tt${main ? " main" : ""}${p ? "" : " tt-empty"}`}>
            <TreeIcon cls={cls} tree={i} size={20} />
            <span className="tt-name">{name}</span>
            <span className="tt-gauge" role="img" aria-label={`${p} points sur 51 dans ${name}, palier ${Math.min(7, Math.floor(p / 5) + 1)}${p >= 31 ? ", talent ultime débloqué" : ""}`}
              title={p >= 31 ? "Talent ultime débloqué (31 points)" : `Palier ${Math.min(7, Math.floor(p / 5) + 1)} atteint`}>
              <i style={{ width: `${Math.min(100, p / 51 * 100)}%` }} />
              {[5, 10, 15, 20, 25, 30].map(t => <span key={t} className="tick" style={{ left: `${t / 51 * 100}%` }} />)}
              <span className={`cap${p >= 31 ? " on" : ""}`} style={{ left: `${31 / 51 * 100}%` }} />
            </span>
            <b className="num tt-pts">{p}</b>
          </div>
        );
      })}
    </div>
  );
}

const CELL = 34, GAP = 8;

/** Un arbre à sa vraie disposition : 4 colonnes, un palier par ligne, flèches des prérequis, infobulle par talent. */
function TreeGrid({ talents, ranks, spent }: { talents: Talent[]; ranks: Map<number, number>; spent: number }) {
  useIconFailures();
  const [tip, setTip] = useState<{ t: Talent; rect: DOMRect } | null>(null);
  const rows = Math.max(7, ...talents.map(t => t.tier + 1));
  const byId = new Map(talents.map(t => [t.id, t]));
  const rank = (t: Talent) => Math.min(t.maxRank, ranks.get(t.id) ?? 0);
  const center = (col: number, tier: number) => ({ x: col * (CELL + GAP) + CELL / 2, y: tier * (CELL + GAP) + CELL / 2 });
  const width = 4 * CELL + 3 * GAP, height = rows * CELL + (rows - 1) * GAP;
  const show = (t: Talent) => (e: React.SyntheticEvent<HTMLElement>) => setTip({ t, rect: e.currentTarget.getBoundingClientRect() });
  return (
    <div className="tg" style={{ width, height }}>
      <svg className="tg-arrows" width={width} height={height} aria-hidden="true">
        {talents.filter(t => t.prereq && byId.has(t.prereq)).map(t => {
          const a = center(byId.get(t.prereq!)!.col, byId.get(t.prereq!)!.tier), b = center(t.col, t.tier);
          return <line key={t.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={rank(t) > 0 ? "on" : ""} />;
        })}
      </svg>
      {talents.map(t => {
        const r = rank(t);
        return (
          <span key={t.id} className={`tg-slot${r ? " on" : ""}${r && r >= t.maxRank ? " max" : ""}${!r && spent < t.tier * 5 ? " locked" : ""}`} tabIndex={0}
            style={{ left: t.col * (CELL + GAP), top: t.tier * (CELL + GAP) }} aria-label={`${t.name} : ${r}/${t.maxRank}`}
            onMouseEnter={show(t)} onFocus={show(t)} onMouseLeave={() => setTip(null)} onBlur={() => setTip(null)}>
            {iconUsable(t.icon ?? undefined) ? <img src={`/icons/items/${t.icon}.jpg`} alt="" loading="lazy" decoding="async" /> : <span className="tg-ph">{t.name.slice(0, 2)}</span>}
            <b className="num">{r}/{t.maxRank}</b>
          </span>
        );
      })}
      {tip && (
        <FloatingTip rect={tip.rect}>
          <div className="t-name">{tip.t.name}</div>
          <div className="t-row">Rang {rank(tip.t)}/{tip.t.maxRank}</div>
          {rank(tip.t) === 0 && tip.t.tier > 0 && <div className="t-dim">Requiert {tip.t.tier * 5} points dans l'arbre</div>}
          {rank(tip.t) === 0 && tip.t.prereq && byId.get(tip.t.prereq) && <div className="t-dim">Requiert {byId.get(tip.t.prereq)!.name}</div>}
          {tip.t.description && <div className="t-yellow" style={{ marginTop: 6 }}>{tip.t.description}</div>}
        </FloatingTip>
      )}
    </div>
  );
}
