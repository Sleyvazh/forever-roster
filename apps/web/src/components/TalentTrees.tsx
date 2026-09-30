import { CLASS_SPECS, CLASSES, type ClassName, type SpecDef } from "@forever/game-data";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get } from "../api";
import { useGameVersion } from "./GameData";
import { SpecIcon } from "./Icons";
import { FloatingTip, iconUsable, useIconFailures } from "./ItemTooltip";

interface Talent { id: number; tree: number; tier: number; col: number; linkIndex: number; maxRank: number; name: string; icon: string | null; prereq: { id: number; rank: number } | null; ranks: string[] }
interface TalentData { trees: { tree: number; name: string; icon: string | null }[]; talents: Talent[] }

/** Arbres de la classe (positions réelles du jeu), chargés une fois par version des données. */
export function useTalentData(cls: string, enabled: boolean) {
  const v = useGameVersion();
  return useQuery({
    queryKey: ["talents", cls, v], enabled: enabled && !!cls, staleTime: 60 * 60_000,
    queryFn: () => get<TalentData>(`/gamedata/talents/${encodeURIComponent(cls)}?v=${v}`),
  });
}

export type TreeView = "gauges" | "grid";
const TIERS = [0, 5, 10, 15, 20, 25, 30];

/** Icône d'un arbre : celle d'une spé de cet arbre (ex. Feral Combat → Feral Cat). */
function TreeIcon({ cls, tree, size }: { cls: string; tree: number; size: number }) {
  const spec = ((CLASS_SPECS as Record<string, readonly SpecDef[]>)[cls] ?? []).find(d => d.tree === tree);
  return spec ? <SpecIcon cls={cls} spec={spec.name} size={size} /> : <span className="ticon-empty" style={{ width: size, height: size }} />;
}

/**
 * Arbres de talents d'un build.
 * « gauges » : jauge par arbre avec les 7 paliers (5 points chacun) et le talent ultime à 31 points.
 * « grid » : un case par talent, avec les rangs lus dans le lien ForeverChanges (rangés 4 par ligne).
 */
export function TalentTrees({ cls, points, blocks, mainTree, view }: {
  cls: string; points: number[]; blocks?: readonly string[] | null; mainTree?: number; view: TreeView;
}) {
  const cl = CLASSES[cls as ClassName];
  if (!cl) return null;
  const top = points.indexOf(Math.max(...points));
  const { data } = useTalentData(cls, view === "grid" && !!blocks);
  const grid = view === "grid" && !!blocks && !!data?.talents.length;
  return (
    <div className={`ttrees ${grid ? "grid" : "gauges"}`}>
      {cl.trees.map((name, i) => {
        const p = points[i] ?? 0;
        const main = mainTree === i || (mainTree === undefined && i === top && p > 0);
        const head = (
          <div className="tt-head">
            <TreeIcon cls={cls} tree={i} size={grid ? 22 : 26} />
            <span className="tt-name">{name}</span>
            <b className="num tt-pts">{p}</b>
          </div>
        );
        if (grid) {
          const list = (data?.talents ?? []).filter(t => t.tree === i);
          return (
            <div key={name} className={`tt${main ? " main" : ""}${p ? "" : " tt-empty"}`}>
              {head}
              <TreeGrid talents={list} digits={[...(blocks![i] ?? "")].map(Number)} spent={p} />
            </div>
          );
        }
        const next = TIERS.filter(t => t <= p).length;
        return (
          <div key={name} className={`tt${main ? " main" : ""}${p ? "" : " tt-empty"}`}>
            {head}
            <div className="tt-gauge" role="img" aria-label={`${p} points sur 51 dans ${name}`}>
              <i style={{ width: `${Math.min(100, p / 51 * 100)}%` }} />
              {[5, 10, 15, 20, 25, 30].map(t => <span key={t} className="tick" style={{ left: `${t / 51 * 100}%` }} />)}
            </div>
            <div className="tt-tiers" aria-hidden="true">
              {TIERS.map((t, k) => <span key={t} className={p > 0 && k < next ? "on" : ""} title={`Palier ${k + 1} : ${t} points`}>{k + 1}</span>)}
              <span className={`cap${p >= 31 ? " on" : ""}`} title="Talent ultime : 31 points">31</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Un arbre à sa vraie disposition : 4 colonnes, un palier par ligne, flèches des prérequis, infobulle par talent. */
function TreeGrid({ talents, digits, spent }: { talents: Talent[]; digits: number[]; spent: number }) {
  useIconFailures();
  const [tip, setTip] = useState<{ t: Talent; rect: DOMRect } | null>(null);
  const rows = Math.max(7, ...talents.map(t => t.tier + 1));
  const rank = (t: Talent) => Math.min(t.maxRank, digits[t.linkIndex] ?? 0);
  const byId = new Map(talents.map(t => [t.id, t]));
  const cx = (col: number) => (col + 0.5) * 25, cy = (tier: number) => (tier + 0.5) / rows * 100;
  const show = (t: Talent) => (e: React.SyntheticEvent<HTMLElement>) => setTip({ t, rect: e.currentTarget.getBoundingClientRect() });
  return (
    <div className="tg" style={{ gridTemplateRows: `repeat(${rows}, auto)` }}>
      <svg className="tg-arrows" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {talents.filter(t => t.prereq && byId.has(t.prereq.id)).map(t => {
          const from = byId.get(t.prereq!.id)!;
          const on = rank(t) > 0;
          return <line key={t.id} x1={cx(from.col)} y1={cy(from.tier)} x2={cx(t.col)} y2={cy(t.tier)} className={on ? "on" : ""} vectorEffect="non-scaling-stroke" />;
        })}
      </svg>
      {talents.map(t => {
        const r = rank(t);
        const locked = r === 0 && spent < t.tier * 5;
        return (
          <span key={t.id} className={`tg-slot${r ? " on" : ""}${r && r >= t.maxRank ? " max" : ""}${locked ? " locked" : ""}`} tabIndex={0}
            style={{ gridColumn: t.col + 1, gridRow: t.tier + 1 }} aria-label={`${t.name} : ${r}/${t.maxRank}`}
            onMouseEnter={show(t)} onFocus={show(t)} onMouseLeave={() => setTip(null)} onBlur={() => setTip(null)}>
            {iconUsable(t.icon ?? undefined) ? <img src={`/icons/items/${t.icon}.jpg`} alt="" loading="lazy" decoding="async" onError={e => { e.currentTarget.style.visibility = "hidden"; }} /> : <span className="tg-ph">{t.name.slice(0, 2)}</span>}
            <b className="num">{r}/{t.maxRank}</b>
          </span>
        );
      })}
      {tip && (
        <FloatingTip rect={tip.rect}>
          <div className="t-name">{tip.t.name}</div>
          <div className="t-row">Rang {rank(tip.t)}/{tip.t.maxRank}</div>
          {tip.t.prereq && byId.get(tip.t.prereq.id) && rank(tip.t) === 0 && (
            <div className="t-dim">Requiert {tip.t.prereq.rank} point{tip.t.prereq.rank > 1 ? "s" : ""} dans {byId.get(tip.t.prereq.id)!.name}</div>
          )}
          {tip.t.tier > 0 && rank(tip.t) === 0 && <div className="t-dim">Requiert {tip.t.tier * 5} points dans l'arbre</div>}
          {rank(tip.t) > 0 && <div className="t-yellow" style={{ marginTop: 6 }}>{tip.t.ranks[rank(tip.t) - 1]}</div>}
          {rank(tip.t) < tip.t.maxRank && tip.t.ranks[rank(tip.t)] && (
            <>
              <div className="t-row" style={{ marginTop: 6 }}>{rank(tip.t) ? "Rang suivant :" : ""}</div>
              <div className="t-yellow">{tip.t.ranks[rank(tip.t)]}</div>
            </>
          )}
        </FloatingTip>
      )}
    </div>
  );
}
