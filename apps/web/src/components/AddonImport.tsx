import { parseCharacterExports, sameCharacter, type CharacterExport } from "@forever/game-data";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, type Character } from "../api";
import { ALL_PARTS, applyExtras, buildPatch, PARTS, partSummary, type Part } from "../addonImport";
import { linkFromRanks, useTalentData } from "./TalentTrees";

/**
 * Mise à jour d'une fiche depuis l'addon : on colle le texte de l'onglet Export (un ou plusieurs persos), le bloc de ce perso
 * est retrouvé par son prénom, on voit ce qui sera repris, puis on choisit les parties à mettre à jour.
 * Pour tous ses persos d'un coup : page Addon.
 */
export function AddonImport({ c, onChange }: { c: Character; onChange: (p: Partial<Character>) => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [parts, setParts] = useState<Set<Part>>(new Set(ALL_PARTS));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const r = text.trim() ? parseCharacterExports(text) : null;
  // Le bloc de ce perso (par son prénom), sinon le seul bloc collé
  const blocks = r?.ok ? r.data : [];
  const d: CharacterExport | null = blocks.find(b => sameCharacter(b.name, c.name)) ?? (blocks.length === 1 ? blocks[0]! : null);

  const classClash = !!(d?.cls && c.cls && d.cls !== c.cls);
  const raceClash = !!(d?.race && c.race && d.race !== c.race);
  const tcls = d?.cls ?? c.cls;
  const tdata = useTalentData(tcls, !!d?.talents.length);
  const build = d && tdata.data ? linkFromRanks(tcls, tdata.data.talents, new Map(d.talents.map(t => [t.id, t.rank]))) : null;
  const toggle = (p: Part) => setParts(s => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const apply = async () => {
    if (!d || classClash) return;
    setBusy(true); setError(null);
    try {
      onChange(await buildPatch(c, d, parts, tdata.data?.talents));
      const extras = await applyExtras(c.id, d, parts);
      await Promise.all([qc.invalidateQueries({ queryKey: ["char-recipes", c.id] }), qc.invalidateQueries({ queryKey: ["raids"] })]);
      setDone(`Fiche mise à jour depuis le jeu.${extras ? ` ${extras}.` : ""}`); setText("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Mise à jour impossible."); }
    finally { setBusy(false); }
  };

  return (
    <details className="addon-import">
      <summary>Importer depuis l'addon <span className="muted small">· équipement, métiers, patrons et talents lus en jeu</span></summary>
      <div className="stack" style={{ gap: 10, paddingTop: 10 }}>
        <p className="hint" style={{ margin: 0 }}>
          En jeu : <code>/fr</code> (ou le bouton de la minicarte), onglet <strong>Export</strong>, Ctrl+C, puis colle ici.
          Pour mettre à jour tous tes persos d'un coup : page <Link to="/addon">Addon</Link>.
        </p>
        <textarea id="f-addon" aria-label="Texte exporté par l'addon" rows={4} spellCheck={false} placeholder="FRC;1;…" value={text}
          onChange={e => { setText(e.target.value); setDone(null); }} />
        {done && !text && <div className="okmsg" role="status">{done}</div>}
        {error && <div className="warnmsg" role="alert">{error}</div>}
        {r && !r.ok && <div className="warnmsg">{r.error}</div>}
        {r?.ok && !d && <div className="warnmsg">Aucun bloc de cet export n'est celui de {c.name} ({blocks.map(b => b.name).join(", ")}). Utilise la page <Link to="/addon">Addon</Link> pour plusieurs persos.</div>}
        {d && (
          <div className="bi-result ok">
            <div><strong>{d.name}</strong> <span className="muted">({d.realm}) · relevé le {new Date(d.time * 1000).toLocaleString("fr-FR")}</span></div>
            {!sameCharacter(d.name, c.name) && <span className="bi-msg bad">Cet export est celui de {d.name}, pas de {c.name} : vérifie que c'est la bonne fiche.</span>}
            {classClash && <span className="bi-msg bad">Classe différente : {d.cls} en jeu, {c.cls} sur la fiche. Rien ne sera repris.</span>}
            {raceClash && <span className="bi-msg bad">Race différente : {d.race} en jeu, {c.race} sur la fiche (la race de la fiche est gardée).</span>}
            <div className="ai-parts">
              {PARTS.map(([k, label]) => (
                <label key={k} className="ai-part">
                  <input type="checkbox" checked={parts.has(k)} onChange={() => toggle(k)} />
                  <span>{label}</span><span className="muted small">{partSummary(d, build)[k]}</span>
                </label>
              ))}
            </div>
            <div className="row">
              <button type="button" className="btn primary sm" disabled={busy || classClash || !parts.size} onClick={() => void apply()}>
                {busy ? "Mise à jour…" : "Mettre à jour la fiche"}
              </button>
              <span className="hint">L'objectif BiS, les intitulés de spé, l'off-spec et les notes ne sont pas modifiés.</span>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}
