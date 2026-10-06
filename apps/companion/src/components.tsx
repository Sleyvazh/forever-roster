import { useEffect, useState, type ReactNode } from "react";
import { call, type Overall } from "./api";

/** Logo de Roster Companion (dessin A : l'épée dans deux flèches de synchro). */
export function Logo({ size = 18 }: { size?: number }) {
  return (
    <svg className="logo" viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <path d="M11.15 22.28 A23 23 0 0 1 51.92 20.50" fill="none" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M55.14 26.97 L56.52 17.95 L47.18 22.51 Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <path d="M52.85 41.72 A23 23 0 0 1 12.08 43.50" fill="none" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round" />
      <path d="M8.86 37.03 L7.48 46.05 L16.82 41.49 Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
      <g transform="translate(11.52 11.6) scale(.64)">
        <path d="M32 3 L34.6 8.5 L34.6 44 L32 48 L29.4 44 L29.4 8.5 Z" fill="currentColor" />
        <path d="M22 44 H42" stroke="currentColor" strokeWidth="4.4" strokeLinecap="round" />
        <rect x="30.2" y="46" width="3.6" height="7.5" fill="currentColor" />
        <rect x="28.8" y="53.8" width="6.4" height="6.4" fill="currentColor" transform="rotate(45 32 57)" />
      </g>
    </svg>
  );
}

/** Barre de titre maison (maquette) : déplacement par glisser, réduire, fermer (cacher ou quitter selon les options). */
export function TitleBar({ title = "Roster Companion", onBack }: { title?: string; onBack?: () => void }) {
  return (
    <div className="tbar" data-tauri-drag-region>
      {onBack ? <button type="button" className="back" onClick={onBack} aria-label="Retour">←</button> : <Logo />}
      <span className="t" data-tauri-drag-region>{title}</span>
      <button type="button" className="wb" aria-label="Réduire" title="Réduire" onClick={() => void call("window_minimize")}>—</button>
      <button type="button" className="wb x" aria-label="Fermer" title="Fermer" onClick={() => void call("window_close")}>✕</button>
    </div>
  );
}

export function Dot({ state }: { state: Overall | "warn" }) {
  const cls = state === "active" ? "" : state === "error" ? "bad" : state === "warn" || state === "paused" ? "warn" : "idle";
  return <span className={`dot ${cls}`} />;
}

export function Spinner() {
  return <span className="spin" aria-hidden="true" />;
}

export function Box({ title, dir, when, attn, children }: { title: string; dir?: string; when?: ReactNode; attn?: boolean; children: ReactNode }) {
  return (
    <section className={`box${attn ? " attn" : ""}`}>
      <h4>{dir && <span className="dir">{dir}</span>}{title}{when && <span className="when">{when}</span>}</h4>
      {children}
    </section>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} aria-label={label} onChange={e => onChange(e.target.checked)} />
      <i />
    </label>
  );
}

const STATUS_MARK: Record<string, [string, string]> = {
  updated: ["✓", ""], created: ["✓", ""], ignored: ["–", "w"], kept: ["=", "w"], skipped: ["–", "w"],
  refused: ["✕", "b"], unknown: ["?", "w"], error: ["✕", "b"],
};
export function Mark({ status }: { status: string }) {
  const [m, c] = STATUS_MARK[status] ?? ["·", "w"];
  return <span className={`ck ${c}`}>{m}</span>;
}

/** Heure actuelle (secondes), mise à jour chaque seconde : compte à rebours, « il y a … ». */
export function useClock() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}
