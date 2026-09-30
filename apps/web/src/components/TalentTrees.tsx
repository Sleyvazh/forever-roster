import { CLASS_SPECS, CLASSES, type ClassName, type SpecDef } from "@forever/game-data";
import { SpecIcon } from "./Icons";

/** Icône d'un arbre : celle d'une spé de cet arbre (ex. Feral Combat → Feral Cat). */
function TreeIcon({ cls, tree, size }: { cls: string; tree: number; size: number }) {
  const spec = ((CLASS_SPECS as Record<string, readonly SpecDef[]>)[cls] ?? []).find(d => d.tree === tree);
  return spec ? <SpecIcon cls={cls} spec={spec.name} size={size} /> : <span className="ticon-empty" style={{ width: size, height: size }} />;
}

/**
 * Arbres de talents d'un build, une ligne par arbre : jauge graduée tous les 5 points (un palier par graduation),
 * repère du talent ultime à 31 points.
 * Les arbres de Forever ne sont pas dans les fichiers publiés du jeu : on n'affiche pas talent par talent.
 */
export function TalentTrees({ cls, points, mainTree }: { cls: string; points: number[]; mainTree?: number }) {
  const cl = CLASSES[cls as ClassName];
  if (!cl) return null;
  const top = points.indexOf(Math.max(...points));
  return (
    <div className="ttrees">
      {cl.trees.map((name, i) => {
        const p = points[i] ?? 0;
        const main = mainTree === i || (mainTree === undefined && i === top && p > 0);
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
