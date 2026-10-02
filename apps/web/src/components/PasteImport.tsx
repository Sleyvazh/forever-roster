import { parseCharacterExports, type CharacterExport } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { get, type Character } from "../api";
import { ALL_PARTS, applyBlocks, blockKey, blockSummary, guessTarget, type ApplyResult, type Target } from "../addonImport";
import { ClassIcon } from "./Icons";

/** Collage dans un champ de saisie : on laisse faire (la fiche a sa propre zone d'import). */
const typing = (el: Element | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);

/**
 * Collage de l'export de l'addon n'importe où sur le site (Ctrl+V hors d'un champ) : les persos sont reconnus,
 * leurs fiches retrouvées (choix mémorisés), et un clic met tout à jour.
 */
export function PasteImport() {
  const qc = useQueryClient();
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 });
  const [blocks, setBlocks] = useState<CharacterExport[] | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const mine = chars.data?.characters ?? [];

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (typing(document.activeElement)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!/^\s*FRC;/.test(text)) return;
      e.preventDefault();
      const r = parseCharacterExports(text);
      setResults(null); setTargets({});
      if (r.ok) { setBlocks(r.data); setErrors(r.errors); } else { setBlocks([]); setErrors([r.error]); }
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  useEffect(() => {
    if (!results) return;
    const t = window.setTimeout(() => { setResults(null); setBlocks(null); }, 10_000);
    return () => window.clearTimeout(t);
  }, [results]);

  if (!blocks) return null;
  const targetOf = (d: CharacterExport) => targets[blockKey(d)] ?? guessTarget(d, mine);
  const count = blocks.filter(d => targetOf(d) !== "skip").length;
  const close = () => { setBlocks(null); setResults(null); };
  const apply = async () => {
    setBusy(true);
    const out = await applyBlocks(blocks, targetOf, ALL_PARTS, mine);
    await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["character"] }),
      qc.invalidateQueries({ queryKey: ["char-recipes"] }), qc.invalidateQueries({ queryKey: ["raids"] })]);
    setResults(out); setBusy(false);
  };

  return (
    <aside className="paste-import" role="dialog" aria-label="Export de l'addon">
      <div className="pi-head">
        <strong>{results ? "Persos mis à jour" : "Export de l'addon reconnu"}</strong>
        <button type="button" className="pi-close" aria-label="Fermer" onClick={close}>✕</button>
      </div>
      {errors.map(e => <div key={e} className="warnmsg small">{blocks.length ? `Bloc ignoré : ${e}` : e}</div>)}
      {results ? (
        <ul className="addon-results">
          {results.map(x => <li key={x.name} className={x.ok ? "ok" : "bad"}><strong>{x.name}</strong> : {x.msg}</li>)}
          {results.length === 0 && <li>Aucun perso mis à jour.</li>}
        </ul>
      ) : blocks.length > 0 && (
        <>
          <ul className="pi-list">
            {blocks.map(d => (
              <li key={blockKey(d)}>
                <span className="with-icon">{d.cls && <ClassIcon cls={d.cls} size={20} />}<span><strong>{d.name}</strong><br /><span className="muted small">{blockSummary(d)}</span></span></span>
                <select aria-label={`Fiche pour ${d.name}`} value={targetOf(d)} onChange={e => setTargets(s => ({ ...s, [blockKey(d)]: e.target.value }))}>
                  {mine.map(c => <option key={c.id} value={c.id} disabled={!!(d.cls && c.cls && c.cls !== d.cls)}>{c.name}</option>)}
                  <option value="new">Nouvelle fiche</option>
                  <option value="skip">Ignorer</option>
                </select>
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="btn primary sm" disabled={busy || !count} onClick={() => void apply()}>
              {busy ? "Mise à jour…" : `Mettre à jour ${count} perso${count > 1 ? "s" : ""}`}
            </button>
            <button type="button" className="btn ghost sm" onClick={close}>Ignorer</button>
          </div>
          <p className="hint small" style={{ margin: 0 }}>L'objectif BiS, les intitulés de spé, l'off-spec et les notes ne sont pas modifiés.</p>
        </>
      )}
    </aside>
  );
}
