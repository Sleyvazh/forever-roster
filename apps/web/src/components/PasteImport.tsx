import { foreignAddonErrors, parseCharacterExports, parseRaidLogs, parseRRB, type CharacterExport, type RaidLogEncounter, type RaidLogExport } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, get, type Character } from "../api";
import { ALL_PARTS, blockKey, blockSummary, guessTarget, importOnServer, PARTS, type ApplyResult, type Part, type Target } from "../addonImport";
import { ClassIcon } from "./Icons";
import { flushAutosaves } from "../autosave";
import { useSite } from "../site";

/** Collage dans un champ de saisie : on laisse faire (c'est du texte tapé ou collé exprès). */
const typing = (el: Element | null) => !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || (el as HTMLElement).isContentEditable);

/** Bilan lu dans le collage : FRB (Forever Roster) ou RRB (Roster, avec les rencontres de boss). */
type PastedLog = RaidLogExport & { encounters?: RaidLogEncounter[] };

/**
 * Collage de l'export de l'addon n'importe où sur le site (Ctrl+V hors d'un champ) : les persos sont reconnus,
 * leurs fiches retrouvées (choix mémorisés), et un clic met tout à jour.
 * Roster (WoW Retail) : seulement les bilans de raid de l'addon Roster (RRB) ; le texte de l'autre addon est signalé.
 */
export function PasteImport() {
  const qc = useQueryClient();
  const site = useSite();
  const retail = site.game === "retail";
  let otherHost: string | undefined;
  try { otherHost = site.other ? new URL(site.other.origin).host : undefined; } catch { otherHost = undefined; }
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), staleTime: 60_000 });
  const [blocks, setBlocks] = useState<CharacterExport[] | null>(null);
  const [pasted, setPasted] = useState("");
  const [logs, setLogs] = useState<PastedLog[]>([]);
  const [skipLogs, setSkipLogs] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [busy, setBusy] = useState(false);
  // Ce qu'on reprend de l'export (lot F) : tout par défaut ; le choix reste pour la visite
  const [parts, setParts] = useState<Set<Part>>(new Set(ALL_PARTS));
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const mine = chars.data?.characters ?? [];

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (typing(document.activeElement)) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      // Export de l'addon Forever Roster (persos, bilan) ou bilan de l'addon Roster : reconnu sur les deux sites
      if (!/^\s*(FR[CB]|RRB);/.test(text)) return;
      e.preventDefault();
      setResults(null); setTargets({}); setSkipLogs(new Set()); setPasted(text);
      if (retail) {
        // Roster : bilans RRB seulement (les persos viennent de Battle.net) ; un texte de Forever Roster est refusé
        const rrb = parseRRB(text, { otherHost });
        setLogs(rrb.data); setBlocks([]);
        setErrors(rrb.errors.map(x => (x.startsWith("Ce texte vient") ? x : `Bilan ignoré : ${x}`)));
        return;
      }
      // Persos (blocs FRC) et bilans de raid relevés par l'addon (blocs FRB), dans le même collage
      const raid = parseRaidLogs(text);
      setLogs(raid.data);
      const errs = [...foreignAddonErrors(text, "forever", otherHost), ...raid.errors.map(x => `Bilan ignoré : ${x}`)];
      if (/(^|\n)\s*FRC;/.test(text)) {
        const r = parseCharacterExports(text);
        if (r.ok) { setBlocks(r.data); errs.push(...r.errors.map(x => `Bloc ignoré : ${x}`)); } else { setBlocks([]); errs.push(r.error); }
      } else setBlocks([]);
      setErrors(errs);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [retail, otherHost]);

  useEffect(() => {
    if (!results) return;
    const t = window.setTimeout(() => { setResults(null); setBlocks(null); }, 10_000);
    return () => window.clearTimeout(t);
  }, [results]);

  if (!blocks) return null;
  const targetOf = (d: CharacterExport) => targets[blockKey(d)] ?? guessTarget(d, mine);
  const count = blocks.filter(d => targetOf(d) !== "skip").length;
  const fresh = blocks.filter(d => targetOf(d) === "new").length;
  const logsToSave = logs.filter(l => !skipLogs.has(l.raidId));
  const close = () => { setBlocks(null); setLogs([]); setResults(null); };
  const apply = async () => {
    setBusy(true);
    await flushAutosaves(); // une modification de la fiche encore en attente part avant l'import, pas après
    let out: ApplyResult[];
    try {
      // Persos puis bilans, appliqués par le serveur (le BiS reçu est coché sur la fiche à jour)
      out = await importOnServer(pasted, Object.fromEntries(blocks.map(d => [blockKey(d), targetOf(d)])), parts, [...skipLogs]);
    } catch (e) {
      out = [{ name: "Mise à jour", ok: false, msg: e instanceof ApiError ? e.message : "mise à jour impossible" }];
    }
    await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["character"] }),
      qc.invalidateQueries({ queryKey: ["char-recipes"] }), qc.invalidateQueries({ queryKey: ["raids"] }), qc.invalidateQueries({ queryKey: ["week"] }),
      qc.invalidateQueries({ queryKey: ["raid"] }), qc.invalidateQueries({ queryKey: ["attendance"] })]);
    setResults(out); setBusy(false);
  };
  const total = count + logsToSave.length;
  const foreign = !blocks.length && !logs.length && errors.some(e => e.startsWith("Ce texte vient"));

  return (
    <aside className="paste-import" role="dialog" aria-label="Export de l'addon">
      <div className="pi-head">
        <strong>{results ? "Mise à jour faite" : foreign ? "Texte de l'autre addon" : "Export de l'addon reconnu"}</strong>
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
                    <span><strong>Bilan de {l.raidName || "raid"}</strong><br /><span className="muted small">{logSummary(l)} · relevé par {l.recorder || "?"}</span></span>
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
          {blocks.length > 0 && (
            <details className="pi-parts">
              <summary>Choisir quoi importer {parts.size < ALL_PARTS.size && <span className="tag warn">{parts.size}/{ALL_PARTS.size}</span>}</summary>
              <div className="ai-parts">
                {PARTS.map(([k, label]) => (
                  <label key={k} className="ai-part">
                    <input type="checkbox" checked={parts.has(k)} onChange={() => setParts(s => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; })} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </details>
          )}
          <div className="row">
            <button type="button" className="btn primary sm" disabled={busy || !total || (count > 0 && !parts.size && !logsToSave.length)} onClick={() => void apply()}>
              {busy ? "Mise à jour…" : [
                count - fresh ? `Mettre à jour ${count - fresh} perso${count - fresh > 1 ? "s" : ""}` : "",
                fresh ? `${count - fresh ? "et créer" : "Créer"} ${fresh} fiche${fresh > 1 ? "s" : ""}` : "",
                logsToSave.length > 1 ? `${count ? "et les" : "Enregistrer les"} ${logsToSave.length} bilans` : logsToSave.length ? `${count ? "et le" : "Enregistrer le"} bilan` : "",
              ].filter(Boolean).join(" ") || "Rien à faire"}
            </button>
            <button type="button" className="btn ghost sm" onClick={close}>Ignorer</button>
          </div>
          {blocks.length > 0 && <p className="hint small" style={{ margin: 0 }}>L'objectif BiS, les intitulés de spé, l'off-spec et les notes ne sont pas modifiés.</p>}
          {retail && <p className="hint small" style={{ margin: 0 }}>Un officier du groupe (ou le créateur du raid) enregistre le bilan ; un nouveau collage remplace le précédent.</p>}
        </>
      )}
    </aside>
  );
}

/** « 18 présents · 4 objets · 3 boss vaincus » (les boss : bilan de Roster). */
function logSummary(l: PastedLog) {
  const parts = [`${l.attendees.length} présent${l.attendees.length > 1 ? "s" : ""}`, `${l.loot.length} objet${l.loot.length > 1 ? "s" : ""}`];
  if (l.encounters) {
    const kills = new Set(l.encounters.filter(e => e.killed).map(e => e.encounterId || e.boss)).size;
    parts.push(`${kills} boss vaincu${kills > 1 ? "s" : ""}`);
  }
  return parts.join(" · ");
}
