import { CLASS_SPECS, CLASSES, type ClassName, type SpecDef } from "@forever/game-data";
import { SpecIcon } from "./Icons";

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
  const grid = view === "grid" && !!blocks;
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
          const digits = [...(blocks![i] ?? "")].map(Number);
          const n = Math.max(digits.length, 16);
          return (
            <div key={name} className={`tt${main ? " main" : ""}${p ? "" : " tt-empty"}`}>
              {head}
              <div className="tt-grid" aria-label={`${p} points dans ${name}, ${digits.filter(Boolean).length} talents`}>
                {Array.from({ length: Math.ceil(n / 4) * 4 }, (_, k) => {
                  const d = digits[k] ?? 0;
                  return <span key={k} className={`tt-slot${d ? " on" : ""}${d >= 5 ? " max" : ""}`} aria-hidden="true">{d || ""}</span>;
                })}
              </div>
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
