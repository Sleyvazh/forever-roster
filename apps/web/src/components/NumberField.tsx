import { useEffect, useRef, useState, type KeyboardEvent } from "react";

/**
 * Champ numérique aux couleurs du site, à la place de l'<input type=number> natif :
 * pas de « 0300 » quand on tape par-dessus un 0, pas de flèches du navigateur,
 * boutons − / + (Maj : ±10), flèches du clavier, valeur ramenée dans [min, max].
 */
export function NumberField({ id, value, min, max, onChange, label, step = 1, stepper = true, className }: {
  id?: string; value: number; min: number; max: number; onChange: (v: number) => void;
  /** Nom accessible si aucun <label htmlFor> ne pointe sur le champ. */
  label?: string; step?: number; stepper?: boolean; className?: string;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  // Valeur changée ailleurs (sauvegarde, autre onglet) : on l'affiche, sauf pendant la saisie
  useEffect(() => { if (!focused.current) setDraft(String(value)); }, [value]);

  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const commit = (n: number) => { const v = clamp(n); setDraft(String(v)); if (v !== value) onChange(v); };

  const type = (raw: string) => {
    const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, String(max).length);
    if (!digits) { setDraft(""); return; } // champ vidé : on attend la suite (ou la sortie du champ)
    const n = Number(digits);
    if (n > max) { commit(max); return; }
    setDraft(digits);
    if (n >= min && n !== value) onChange(n);
  };
  const key = (e: KeyboardEvent) => {
    const d = e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    commit(value + d * step * (e.shiftKey ? 10 : 1));
  };
  const bump = (d: number, big: boolean) => commit(value + d * step * (big ? 10 : 1));

  return (
    <span className={`numfield${stepper ? "" : " bare"}${className ? ` ${className}` : ""}`}>
      {stepper && <button type="button" tabIndex={-1} aria-hidden="true" disabled={value <= min} onClick={e => bump(-1, e.shiftKey)}>−</button>}
      <input id={id} type="text" inputMode="numeric" autoComplete="off" className="num" aria-label={label}
        role="spinbutton" aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}
        value={draft} onChange={e => type(e.target.value)} onKeyDown={key}
        onFocus={e => { focused.current = true; e.currentTarget.select(); }}
        onBlur={() => { focused.current = false; commit(draft === "" ? min : Number(draft)); }} />
      {stepper && <button type="button" tabIndex={-1} aria-hidden="true" disabled={value >= max} onClick={e => bump(1, e.shiftKey)}>+</button>}
    </span>
  );
}
