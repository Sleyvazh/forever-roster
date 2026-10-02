import { isValidCombo, parseCharacterExport, PROFESSION_SKILL_LINES, professionsFromExport, type CharacterExport } from "@forever/game-data";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, get, post, type Character, type GameItem } from "../api";

type Part = "identity" | "gear" | "professions" | "recipes" | "talents";
const PARTS: [Part, string][] = [["identity", "Niveau, race et classe"], ["gear", "Équipement porté"], ["professions", "Métiers"], ["recipes", "Patrons connus"], ["talents", "Talents"]];

/**
 * Mise à jour d'une fiche depuis l'addon : on colle le texte de « /fr export », on voit ce qui sera repris,
 * puis on choisit les parties à mettre à jour. L'objectif BiS et les notes ne sont jamais touchés.
 */
export function AddonImport({ c, onChange }: { c: Character; onChange: (p: Partial<Character>) => void }) {
  const qc = useQueryClient();
  const [text, setText] = useState("");
  const [parts, setParts] = useState<Set<Part>>(new Set(PARTS.map(p => p[0])));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const r = text.trim() ? parseCharacterExport(text) : null;
  const d: CharacterExport | null = r?.ok ? r.data : null;

  const classClash = !!(d?.cls && c.cls && d.cls !== c.cls);
  const raceClash = !!(d?.race && c.race && d.race !== c.race);
  const gearCount = d ? Object.keys(d.gear).length : 0;
  const spent = d ? d.talents.reduce((a, t) => a + t.rank, 0) : 0;
  const count: Record<Part, string> = {
    identity: d ? `niveau ${d.level}${d.cls ? ` · ${d.cls}` : ""}${d.race ? ` · ${d.race}` : ""}` : "",
    gear: `${gearCount} pièce${gearCount > 1 ? "s" : ""}`,
    professions: d ? d.professions.map(p => `${p.name} ${p.skill}`).join(", ") || "aucun" : "",
    recipes: d ? `${d.recipes.length} patron${d.recipes.length > 1 ? "s" : ""}${d.recipes.length ? "" : " (ouvre tes fenêtres de métier en jeu avant d'exporter)"}` : "",
    talents: d ? `${spent} point${spent > 1 ? "s" : ""} dans ${d.talents.filter(t => t.rank > 0).length} talents` : "",
  };
  const toggle = (p: Part) => setParts(s => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const apply = async () => {
    if (!d || classClash) return;
    setBusy(true); setError(null);
    try {
      const patch: Partial<Character> = {};
      if (parts.has("identity")) {
        patch.level = d.level;
        if (d.cls && !c.cls) patch.cls = d.cls;
        if (d.race && !c.race && isValidCombo(d.race, d.cls ?? c.cls)) patch.race = d.race;
      }
      if (parts.has("gear") && gearCount) {
        const ids = [...new Set(Object.values(d.gear))];
        const { items } = await get<{ items: Record<number, GameItem> }>(`/gamedata/items/batch?ids=${ids.join(",")}`);
        const gear = { ...c.gear };
        for (const [slot, id] of Object.entries(d.gear)) {
          const it = items[id!];
          gear[slot] = { ...gear[slot], cur: it?.name ?? `Objet ${id}`, curId: it ? id : null, q: it?.quality ?? null };
        }
        patch.gear = gear;
      }
      if (parts.has("professions") && d.professions.length) patch.professions = professionsFromExport(d.professions);
      if (parts.has("talents") && d.talents.length) patch.talentNodes = d.talents;
      onChange(patch);
      let recipesMsg = "";
      if (parts.has("recipes") && d.recipes.length) {
        const res = await post<{ known: number; unknown: number }>(`/characters/${c.id}/recipes/import`, {
          spellIds: d.recipes.flatMap(x => (x.spellId ? [x.spellId] : [])), itemIds: d.recipes.flatMap(x => (x.itemId ? [x.itemId] : [])),
          professions: d.professions.map(p => p.name).filter(n => n in PROFESSION_SKILL_LINES),
        });
        await qc.invalidateQueries({ queryKey: ["char-recipes", c.id] });
        recipesMsg = ` ${res.known} patron${res.known > 1 ? "s" : ""} coché${res.known > 1 ? "s" : ""}${res.unknown ? `, ${res.unknown} inconnu${res.unknown > 1 ? "s" : ""} de la base` : ""}.`;
      }
      setDone(`Fiche mise à jour depuis le jeu.${recipesMsg}`); setText("");
    } catch (e) { setError(e instanceof ApiError ? e.message : "Mise à jour impossible."); }
    finally { setBusy(false); }
  };

  return (
    <details className="addon-import">
      <summary>Importer depuis l'addon <span className="muted small">· équipement, métiers, patrons et talents lus en jeu</span></summary>
      <div className="stack" style={{ gap: 10, paddingTop: 10 }}>
        <p className="hint" style={{ margin: 0 }}>
          En jeu, avec l'addon Forever Roster : ouvre tes fenêtres de métier (pour les patrons), tape <code>/fr export</code>, copie le texte (Ctrl+C) et colle-le ici.
        </p>
        <textarea id="f-addon" aria-label="Texte exporté par l'addon" rows={4} spellCheck={false} placeholder="FRC;1;…" value={text}
          onChange={e => { setText(e.target.value); setDone(null); }} />
        {done && !text && <div className="okmsg" role="status">{done}</div>}
        {error && <div className="warnmsg" role="alert">{error}</div>}
        {r && !r.ok && <div className="warnmsg">{r.error}</div>}
        {d && (
          <div className="bi-result ok">
            <div><strong>{d.name}</strong> <span className="muted">({d.realm}) · exporté le {new Date(d.time * 1000).toLocaleString("fr-FR")}</span></div>
            {d.name.toLowerCase() !== c.name.toLowerCase() && <span className="bi-msg bad">Cet export est celui de {d.name}, pas de {c.name} : vérifie que c'est la bonne fiche.</span>}
            {classClash && <span className="bi-msg bad">Classe différente : {d.cls} en jeu, {c.cls} sur la fiche. Rien ne sera repris.</span>}
            {raceClash && <span className="bi-msg bad">Race différente : {d.race} en jeu, {c.race} sur la fiche (la race de la fiche est gardée).</span>}
            <div className="ai-parts">
              {PARTS.map(([k, label]) => (
                <label key={k} className="ai-part">
                  <input type="checkbox" checked={parts.has(k)} onChange={() => toggle(k)} />
                  <span>{label}</span><span className="muted small">{count[k]}</span>
                </label>
              ))}
            </div>
            <div className="row">
              <button type="button" className="btn primary sm" disabled={busy || classClash || !parts.size} onClick={() => void apply()}>
                {busy ? "Mise à jour…" : "Mettre à jour la fiche"}
              </button>
              <span className="hint">L'objectif BiS, les spés et les notes ne sont pas modifiés.</span>
            </div>
          </div>
        )}
      </div>
    </details>
  );
}

