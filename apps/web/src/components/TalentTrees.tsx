import { CLASS_SPECS, CLASSES, type ClassName, type SpecDef } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "../api";
import { useGameVersion } from "./GameData";
import { SpecIcon } from "./Icons";
import { FloatingTip, iconUsable, useIconFailures } from "./ItemTooltip";
import { colon, t, tx } from "../i18n";

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
    for (const tt of talents) ranks.set(tt.id, Number(source.blocks[tt.tree]?.[tt.linkIndex] ?? 0));
    // Un lien qui ne colle pas aux arbres (rang au-delà du maximum, trop de chiffres) n'est pas utilisé
    const fits = source.blocks.every((b, tree) => b.length <= talents.filter(tt => tt.tree === tree).length)
      && talents.every(tt => (ranks.get(tt.id) ?? 0) <= tt.maxRank);
    return fits ? ranks : null;
  }
  if (source.nodes?.length) {
    const known = new Set(talents.map(tt => tt.id));
    for (const n of source.nodes) if (known.has(n.id)) ranks.set(n.id, n.rank);
    return ranks.size ? ranks : null;
  }
  return null;
}

/** Lien ForeverChanges et répartition reconstruits depuis des rangs par nœud (export de l'addon). */
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
              <TreeGrid talents={talents!.filter(tt => tt.tree === i)} ranks={ranks!} spent={p} />
            </div>
          );
        }
        return (
          <div key={name} className={`tt${main ? " main" : ""}${p ? "" : " tt-empty"}`}>
            <TreeIcon cls={cls} tree={i} size={20} />
            <span className="tt-name">{name}</span>
            <span className="tt-gauge" role="img" aria-label={`${p} points sur 51 dans ${name}, palier ${Math.min(7, Math.floor(p / 5) + 1)}${p >= 31 ? t(", talent ultime débloqué") : ""}`}
              title={p >= 31 ? t("Talent ultime débloqué (31 points)") : t("Palier {n} atteint", { n: Math.min(7, Math.floor(p / 5) + 1) })}>
              <i style={{ width: `${Math.min(100, p / 51 * 100)}%` }} />
              {[5, 10, 15, 20, 25, 30].map(tt => <span key={tt} className="tick" style={{ left: `${tt / 51 * 100}%` }} />)}
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
  const rows = Math.max(7, ...talents.map(tt => tt.tier + 1));
  const byId = new Map(talents.map(tt => [tt.id, tt]));
  const rank = (tt: Talent) => Math.min(tt.maxRank, ranks.get(tt.id) ?? 0);
  const center = (col: number, tier: number) => ({ x: col * (CELL + GAP) + CELL / 2, y: tier * (CELL + GAP) + CELL / 2 });
  const width = 4 * CELL + 3 * GAP, height = rows * CELL + (rows - 1) * GAP;
  const show = (tt: Talent) => (e: React.SyntheticEvent<HTMLElement>) => setTip({ t: tt, rect: e.currentTarget.getBoundingClientRect() });
  return (
    <div className="tg" style={{ width, height }}>
      <svg className="tg-arrows" width={width} height={height} aria-hidden="true">
        {talents.filter(tt => tt.prereq && byId.has(tt.prereq)).map(tt => {
          const a = center(byId.get(tt.prereq!)!.col, byId.get(tt.prereq!)!.tier), b = center(tt.col, tt.tier);
          return <line key={tt.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={rank(tt) > 0 ? "on" : ""} />;
        })}
      </svg>
      {talents.map(tt => {
        const r = rank(tt);
        return (
          <span key={tt.id} className={`tg-slot${r ? " on" : ""}${r && r >= tt.maxRank ? " max" : ""}${!r && spent < tt.tier * 5 ? " locked" : ""}`} tabIndex={0}
            style={{ left: tt.col * (CELL + GAP), top: tt.tier * (CELL + GAP) }} aria-label={`${tt.name}${colon()}${r}/${tt.maxRank}`}
            onMouseEnter={show(tt)} onFocus={show(tt)} onMouseLeave={() => setTip(null)} onBlur={() => setTip(null)}>
            {iconUsable(tt.icon ?? undefined) ? <img src={`/icons/items/${tt.icon}.jpg`} alt="" loading="lazy" decoding="async" /> : <span className="tg-ph">{tt.name.slice(0, 2)}</span>}
            <b className="num">{r}/{tt.maxRank}</b>
          </span>
        );
      })}
      {tip && (
        <FloatingTip rect={tip.rect}>
          <div className="t-name">{tip.t.name}</div>
          <div className="t-row">{t("Rang {r}/{max}", { r: rank(tip.t), max: tip.t.maxRank })}</div>
          {rank(tip.t) === 0 && tip.t.tier > 0 && <div className="t-dim">{tx("Requiert {v} points dans l'arbre", { v: tip.t.tier * 5 })}</div>}
          {rank(tip.t) === 0 && tip.t.prereq && byId.get(tip.t.prereq) && <div className="t-dim">{t("Requiert {name}", { name: byId.get(tip.t.prereq)!.name })}</div>}
          {tip.t.description && <div className="t-yellow" style={{ marginTop: 6 }}>{tip.t.description}</div>}
        </FloatingTip>
      )}
    </div>
  );
}
