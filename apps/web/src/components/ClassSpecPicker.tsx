import { CLASS_SPECS, CLASSES, type ClassName, type SpecDef } from "@forever/game-data";
import type { CSSProperties } from "react";
import { useGameText } from "../gameText";
import { ClassDot } from "./Outings";

/** Classe en neuf boutons, puis la spé en trois ou quatre boutons (avec son rôle) : un clic chacun. */
export function ClassSpecPicker({ cls, spec, onCls, onSpec, idPrefix = "cs" }: {
  cls: ClassName | ""; spec: string; onCls: (c: ClassName) => void; onSpec: (s: string) => void; idPrefix?: string;
}) {
  const gt = useGameText();
  const specs: readonly SpecDef[] = cls ? (CLASS_SPECS as Record<string, SpecDef[]>)[cls] ?? [] : [];
  return (
    <>
      <div className="fld"><span className="lbl" id={`${idPrefix}-cls`}>Classe</span>
        <div className="cls-pick" role="group" aria-labelledby={`${idPrefix}-cls`}>
          {(Object.keys(CLASSES) as ClassName[]).map(c => (
            <button key={c} type="button" className="cls-b" aria-pressed={cls === c} style={{ "--cc": CLASSES[c].color } as CSSProperties}
              onClick={() => onCls(c)}><ClassDot cls={c} /><span>{gt.cls(c)}</span></button>
          ))}
        </div>
      </div>
      {cls && (
        <div className="fld"><span className="lbl" id={`${idPrefix}-spec`}>Spé</span>
          <div className="spec-pick" role="group" aria-labelledby={`${idPrefix}-spec`}>
            {specs.map(s => (
              <button key={s.name} type="button" className="spec-b" aria-pressed={spec === s.name} onClick={() => onSpec(s.name)}>
                <b>{gt.spec(cls, s.name)}</b><span className={`role xs ${s.role}`}>{s.role}</span></button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
