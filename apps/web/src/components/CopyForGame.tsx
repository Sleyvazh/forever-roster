import { useState } from "react";
import { get } from "../api";
import { useSite } from "../site";

type GameData = { text: string; groups: { name: string; raids: number; patterns: number; bis: number }[] };

/**
 * Copie les données de tous mes groupes pour l'addon (FRG pour Forever Roster, RRG pour l'addon Roster de WoW Retail :
 * l'adresse du site choisit le format). Le texte est demandé au serveur pendant le clic :
 * ClipboardItem avec une promesse garde l'autorisation de copier (Safari), sinon écriture classique.
 */
export async function copyGameData(): Promise<GameData> {
  const data = get<GameData>("/addon/export");
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/plain": data.then(d => new Blob([d.text], { type: "text/plain" })) })]);
      return data;
    } catch { /* repli ci-dessous */ }
  }
  const d = await data;
  await navigator.clipboard.writeText(d.text);
  return d;
}

/** Bouton de la barre du haut : « Copier pour le jeu », sur toutes les pages. */
export function CopyForGame() {
  const retail = useSite().game === "retail";
  const [state, setState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const click = async () => {
    setState("busy");
    try { await copyGameData(); setState("ok"); } catch { setState("err"); }
    window.setTimeout(() => setState("idle"), 2500);
  };
  const label = state === "ok" ? "Copié : colle en jeu" : state === "err" ? "Copie impossible" : state === "busy" ? "Copie…" : "Copier pour le jeu";
  return (
    <button type="button" className={`btn sm copy-game${state === "ok" ? " done" : ""}`} onClick={() => void click()} disabled={state === "busy"}
      title={retail ? "Raids à venir de tes groupes et tes inscriptions : à coller dans l'onglet Synchro de l'addon Roster (ou sa synchro rapide)"
        : "Raids à venir, patrons et BiS recherchés de tes groupes : à coller dans l'onglet Synchro de l'addon"} aria-live="polite">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" /></svg>
      <span>{label}</span>
    </button>
  );
}
