import { DIFFICULTY_LABEL, RETAIL_DIFFICULTIES, RETAIL_RAIDS, retailDefaultSize, retailRaidLabel, retailSizeRange, retailTargets, type RetailDifficulty } from "@forever/game-data";
import { useGameText } from "../gameText";
import { NumberField } from "./NumberField";

/**
 * Roster (WoW Retail) : difficulté du raid et effectif. Normal et Héroïque de 10 à 30, Mythique 20
 * (ou flexible pour certains raids, ex. Kith'ix 15 à 25). Changer de difficulté propose l'effectif par défaut.
 */
export function RetailFormat({ name, difficulty, size, onChange, idPrefix, hideTargets }: {
  name: string; difficulty: RetailDifficulty; size: number; idPrefix: string; hideTargets?: boolean;
  onChange: (f: { difficulty: RetailDifficulty; size: number }) => void;
}) {
  const t = useGameText();
  const { min, max } = retailSizeRange(difficulty, name);
  const target = retailTargets(size);
  return (
    <div className="row" style={{ gap: 14 }}>
      <div className="seg" role="group" aria-label="Difficulté">
        {RETAIL_DIFFICULTIES.map(d => (
          <button key={d} type="button" className={difficulty === d ? "on" : ""} aria-pressed={difficulty === d}
            onClick={() => difficulty !== d && onChange({ difficulty: d, size: retailDefaultSize(d, name) })}>{DIFFICULTY_LABEL[d][t.lang]}</button>
        ))}
      </div>
      {min === max
        ? <span className="muted small"><b className="num">{min}</b> joueurs</span>
        : <span className="row" style={{ gap: 8 }}><span style={{ width: 110 }}><NumberField id={`${idPrefix}-size`} min={min} max={max} value={Math.max(min, Math.min(max, size))} onChange={n => onChange({ difficulty, size: n })} /></span>
          <span className="muted small">joueurs ({min} à {max})</span></span>}
      {!hideTargets && <span className="muted small">{target.tank} tanks · {target.heal} heals · {target.dps} DPS visés</span>}
    </div>
  );
}

/** Raids de Midnight proposés à la création (dans la langue choisie). */
export function RetailRaidChips({ value, onPick }: { value: string; onPick: (name: string) => void }) {
  const t = useGameText();
  return (
    <div className="gr-chips"><span className="muted small">Midnight :</span>
      {RETAIL_RAIDS.map(r => { const n = retailRaidLabel(r, t.lang); return <button key={r.key} type="button" className={`dt-chip${value === n ? " on" : ""}`} onClick={() => onPick(n)}>{n}</button>; })}
    </div>
  );
}
