import { useState } from "react";

export type ThemeChoice = "system" | "light" | "dark";
const KEY = "fr-theme";

export function readTheme(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : "system"; } catch { return "system"; }
}

/** Applique le choix : « system » retire l'attribut et laisse prefers-color-scheme décider. */
export function applyTheme(t: ThemeChoice) {
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeChoice>(readTheme);
  const choose = (t: ThemeChoice) => {
    setTheme(t); applyTheme(t);
    try { if (t === "system") localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* stockage indisponible : le choix vaut pour cet onglet */ }
  };
  const opts: [ThemeChoice, string][] = [["system", "Auto"], ["light", "Clair"], ["dark", "Sombre"]];
  return (
    <div className="theme-seg" role="group" aria-label="Thème">
      {opts.map(([k, l]) => <button key={k} type="button" aria-pressed={theme === k} onClick={() => choose(k)} title={k === "system" ? "Suivre le réglage de Windows / du téléphone" : undefined}>{l}</button>)}
    </div>
  );
}
