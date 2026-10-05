import { parseCharacterExports, parseRaidLogs, type CharacterExport, type RaidLogExport } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, get, post, type Character } from "../api";
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
  const [logs, setLogs] = useState<RaidLogExport[]>([]);
  const [skipLogs, setSkipLogs] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const mine = chars.data?.characters ?? [];

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (typing(document.activeElement)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!/^\s*FR[CB];/.test(text)) return;
      e.preventDefault();
      setResults(null); setTargets({}); setSkipLogs(new Set());
      // Persos (blocs FRC) et bilans de raid relevés par l'addon (blocs FRB), dans le même collage
      const raid = parseRaidLogs(text);
      setLogs(raid.data);
      const errs = [...raid.errors.map(x => `Bilan ignoré : ${x}`)];
      if (/(^|\n)\s*FRC;/.test(text)) {
        const r = parseCharacterExports(text);
        if (r.ok) { setBlocks(r.data); errs.push(...r.errors.map(x => `Bloc ignoré : ${x}`)); } else { setBlocks([]); errs.push(r.error); }
      } else setBlocks([]);
      setErrors(errs);
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
  const logsToSave = logs.filter(l => !skipLogs.has(l.raidId));
  const close = () => { setBlocks(null); setLogs([]); setResults(null); };
  const apply = async () => {
    setBusy(true);
    const out: ApplyResult[] = [];
    out.push(...await applyBlocks(blocks, targetOf, ALL_PARTS, mine));
    // Bilans après les persos : le BiS reçu est coché sur la fiche à jour (sinon l'équipement des persos l'écraserait)
    for (const l of logsToSave) {
      const label = `Bilan de ${l.raidName || "raid"}`;
      try {
        const r = await post<{ attendees: number; loot: number; bis: number; unknown: string[] }>("/raid-logs",
          { raidId: l.raidId, start: l.start, end: l.end, recorder: l.recorder, instance: l.instance, attendees: l.attendees, loot: l.loot });
        out.push({ name: label, ok: true, msg: `enregistré · ${r.attendees} présent${r.attendees > 1 ? "s" : ""}, ${r.loot} objet${r.loot > 1 ? "s" : ""}${r.bis ? `, ${r.bis} BiS coché${r.bis > 1 ? "s" : ""}` : ""}${r.unknown.length ? ` · sans fiche : ${r.unknown.slice(0, 5).join(", ")}${r.unknown.length > 5 ? "…" : ""}` : ""}` });
      } catch (e) { out.push({ name: label, ok: false, msg: e instanceof ApiError ? e.message : "enregistrement impossible" }); }
    }
    await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["character"] }),
      qc.invalidateQueries({ queryKey: ["char-recipes"] }), qc.invalidateQueries({ queryKey: ["raids"] }), qc.invalidateQueries({ queryKey: ["week"] }),
      qc.invalidateQueries({ queryKey: ["raid"] }), qc.invalidateQueries({ queryKey: ["attendance"] })]);
    setResults(out); setBusy(false);
  };
  const total = count + logsToSave.length;

  return (
    <aside className="paste-import" role="dialog" aria-label="Export de l'addon">
      <div className="pi-head">
        <strong>{results ? "Mise à jour faite" : "Export de l'addon reconnu"}</strong>
        <button type="button" className="pi-close" aria-label="Fermer" onClick={close}>✕</button>
      </div>
      {errors.map(e => <div key={e} className="warnmsg small">{e}</div>)}
      {results ? (
        <ul className="addon-results">
          {results.map(x => <li key={x.name} className={x.ok ? "ok" : "bad"}><strong>{x.name}</strong> : {x.msg}</li>)}
          {results.length === 0 && <li>Rien de mis à jour.</li>}
        </ul>
      ) : (blocks.length > 0 || logs.length > 0) && (
        <>
          {logs.length > 0 && (
            <ul className="pi-list">
              {logs.map(l => (
                <li key={l.raidId}>
                  <label className="with-icon pi-log">
                    <input type="checkbox" checked={!skipLogs.has(l.raidId)} onChange={() => setSkipLogs(s => { const n = new Set(s); if (n.has(l.raidId)) n.delete(l.raidId); else n.add(l.raidId); return n; })} />
                    <span><strong>Bilan de {l.raidName || "raid"}</strong><br /><span className="muted small">{l.attendees.length} présent{l.attendees.length > 1 ? "s" : ""} · {l.loot.length} objet{l.loot.length > 1 ? "s" : ""} · relevé par {l.recorder || "?"}</span></span>
                  </label>
                </li>
              ))}
            </ul>
          )}
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
            <button type="button" className="btn primary sm" disabled={busy || !total} onClick={() => void apply()}>
              {busy ? "Mise à jour…" : [count ? `Mettre à jour ${count} perso${count > 1 ? "s" : ""}` : "", logsToSave.length ? `${count ? "et le" : "Enregistrer le"} bilan${logsToSave.length > 1 ? "s" : ""}` : ""].filter(Boolean).join(" ") || "Rien à faire"}
            </button>
            <button type="button" className="btn ghost sm" onClick={close}>Ignorer</button>
          </div>
          <p className="hint small" style={{ margin: 0 }}>L'objectif BiS, les intitulés de spé, l'off-spec et les notes ne sont pas modifiés.</p>
        </>
      )}
    </aside>
  );
}
