import { parseCharacterExports, sameCharacter, type CharacterExport } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, get, patch, post, type Character } from "../api";
import { ALL_PARTS, applyExtras, buildPatch, PARTS, type Part } from "../addonImport";
import { ClassIcon } from "../components/Icons";

declare const __ADDON_VERSION__: string;
declare const __ADDON_SHA256__: string;

/**
 * Page Addon : installer l'addon, envoyer en jeu les données de ses groupes (raids, patrons et BiS suivis),
 * et mettre à jour tous ses persos d'un coup avec l'export du jeu.
 */
export function AddonPage() {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head"><div><div className="eyebrow">Addon Forever Roster</div><h1>Le jeu et le site</h1></div></div>
      <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
        Un addon n'a pas accès à internet : les échanges passent par un copier-coller. Du site vers le jeu, une fois par soirée
        (raids à venir, patrons et BiS recherchés). Du jeu vers le site, quand tu veux : l'addon relève tout seul chacun de tes persos.
      </p>
      <div className="addon-steps">
        <Install />
        <ToGame />
        <FromGame />
        <Commands />
      </div>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="panel pad stack addon-step" aria-labelledby={`step-${n}`}>
      <h2 id={`step-${n}`} className="addon-step-title"><span className="addon-step-n">{n}</span>{title}</h2>
      {children}
    </section>
  );
}

function Install() {
  return (
    <Step n={1} title="Installer l'addon">
      <div className="row">
        <a className="btn primary" href="/downloads/ForeverRoster.zip" download>Télécharger l'addon {__ADDON_VERSION__}</a>
        <span className="muted small">Interface 16001 (client de WoW Forever)</span>
      </div>
      <ol className="addon-list">
        <li>Ouvre le zip et copie le dossier <code>ForeverRoster</code> dans <code>World of Warcraft\_classic_beta_\Interface\AddOns\</code> (après la sortie : <code>_classic_</code>). Remplace l'ancien dossier s'il existe.</li>
        <li>Relance le jeu, ou tape <code>/reload</code>.</li>
        <li>Clique sur le livre autour de la minicarte, ou tape <code>/fr</code> : une seule fenêtre, avec les onglets Raids, Compo, Patrons et Export.</li>
      </ol>
      <details className="addon-safety">
        <summary>Sécurité : ce que fait (et ne fait pas) l'addon</summary>
        <ul className="addon-list">
          <li>Le zip ne contient que des fichiers texte <code>.lua</code> et <code>.toc</code> : aucun programme à installer ni à lancer sur ton PC.</li>
          <li>Un addon tourne dans le jeu, sans accès à internet, à tes fichiers ou à ton compte : il ne connaît ni ton mot de passe, ni ta session sur le site. Les échanges passent uniquement par ton copier-coller.</li>
          <li>Il n'envoie rien dans le chat sans un clic de ta part (« Annoncer ») et n'agit pas à ta place en combat.</li>
          <li>Le code est public : <a href="https://github.com/Sleyvazh/forever-roster/tree/main/addon/ForeverRoster" target="_blank" rel="noopener noreferrer">addon/ForeverRoster sur GitHub</a>.</li>
          {__ADDON_SHA256__ && <li>Empreinte SHA-256 du zip, pour vérifier qu'il est intact (PowerShell : <code>Get-FileHash ForeverRoster.zip</code>) : <code className="sha">{__ADDON_SHA256__}</code></li>}
        </ul>
      </details>
    </Step>
  );
}

function ToGame() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const q = useQuery({
    queryKey: ["addon-export-all"], enabled: open, staleTime: 0,
    queryFn: () => get<{ text: string; groups: { name: string; raids: number; patterns: number; bis: number }[] }>("/addon/export"),
  });
  const copy = async () => {
    setOpen(true);
    const data = q.data ?? (await q.refetch()).data;
    if (!data) return;
    try { await navigator.clipboard.writeText(data.text); setCopied(true); window.setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); }
  };
  return (
    <Step n={2} title="Du site vers le jeu : mes groupes">
      <p className="hint" style={{ margin: 0 }}>
        Raids à venir (pour t'inscrire en jeu), patrons recherchés ou connus et objets BiS recherchés par les persos de tes groupes :
        infobulles en jeu, liste des sacs et alerte quand tu ramasses l'un d'eux.
      </p>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => void copy()}>{copied ? "Copié" : "Copier les données de mes groupes"}</button>
        {!open && <button type="button" className="btn ghost sm" onClick={() => setOpen(true)}>Voir le texte</button>}
      </div>
      {q.isFetching && <p className="hint">Préparation…</p>}
      {q.error && <div className="warnmsg">Impossible de préparer les données.</div>}
      {q.data && (
        <>
          {q.data.groups.length === 0 ? <p className="muted">Tu n'es dans aucun groupe.</p> : (
            <ul className="addon-groups">
              {q.data.groups.map(g => (
                <li key={g.name}><strong>{g.name}</strong> <span className="muted small">· {g.raids} raid{g.raids > 1 ? "s" : ""} à venir · {g.patterns} patron{g.patterns > 1 ? "s" : ""} · {g.bis} BiS</span></li>
              ))}
            </ul>
          )}
          <textarea id="ga-all" readOnly className="num" aria-label="Données de mes groupes pour l'addon" rows={Math.min(8, q.data.text.split("\n").length)} value={q.data.text} onFocus={e => e.currentTarget.select()} />
        </>
      )}
      <p className="hint" style={{ margin: 0 }}>En jeu : onglet <strong>Raids</strong>, colle (Ctrl+V), puis <strong>Charger</strong>. À refaire quand de nouveaux raids ou recherches apparaissent.</p>
    </Step>
  );
}

type Target = string; // id d'une fiche, « new » ou « skip »

function FromGame() {
  const qc = useQueryClient();
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters") });
  const [text, setText] = useState("");
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [parts, setParts] = useState<Set<Part>>(new Set(ALL_PARTS));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<{ name: string; ok: boolean; msg: string }[] | null>(null);
  const r = text.trim() ? parseCharacterExports(text) : null;
  const blocks = r?.ok ? r.data : [];
  const mine = chars.data?.characters ?? [];

  const key = (d: CharacterExport) => `${d.name}-${d.realm}`;
  const guess = (d: CharacterExport): Target =>
    mine.find(c => sameCharacter(d.name, c.name) && (!c.cls || !d.cls || c.cls === d.cls))?.id ?? "new";
  const targetOf = (d: CharacterExport) => targets[key(d)] ?? guess(d);
  const toggle = (p: Part) => setParts(s => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const apply = async () => {
    setBusy(true);
    const out: { name: string; ok: boolean; msg: string }[] = [];
    for (const d of blocks) {
      const t = targetOf(d);
      if (t === "skip") continue;
      try {
        let c = mine.find(x => x.id === t);
        if (t === "new") c = (await post<{ character: Character }>("/characters", { name: d.name })).character;
        if (!c) throw new Error("fiche introuvable");
        if (d.cls && c.cls && d.cls !== c.cls) { out.push({ name: d.name, ok: false, msg: `classe différente sur la fiche (${c.cls})` }); continue; }
        // Une nouvelle fiche prend toujours niveau, race et classe
        const p = await buildPatch(c, d, t === "new" ? new Set([...parts, "identity"]) : parts);
        if (Object.keys(p).length) await patch(`/characters/${c.id}`, p);
        const extras = await applyExtras(c.id, d, parts);
        out.push({ name: d.name, ok: true, msg: `${t === "new" ? "fiche créée" : "fiche mise à jour"}${extras ? ` · ${extras}` : ""}` });
      } catch (e) {
        out.push({ name: d.name, ok: false, msg: e instanceof ApiError ? e.message : "mise à jour impossible" });
      }
    }
    await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["char-recipes"] }), qc.invalidateQueries({ queryKey: ["raids"] })]);
    setResults(out); setText(""); setTargets({}); setBusy(false);
  };

  return (
    <Step n={3} title="Du jeu vers le site : mettre à jour mes persos">
      <p className="hint" style={{ margin: 0 }}>
        En jeu : onglet <strong>Export</strong> (ou clic droit sur le bouton de la minicarte), Ctrl+C, puis colle ici. Tous les persos sur lesquels tu t'es
        connecté sont inclus : équipement, métiers, patrons, talents, inscriptions et patrons marqués recherchés en jeu.
      </p>
      <textarea id="addon-import-all" aria-label="Texte exporté par l'addon" rows={4} spellCheck={false} placeholder="FRC;1;…" value={text}
        onChange={e => { setText(e.target.value); setResults(null); }} />
      {r && !r.ok && <div className="warnmsg">{r.error}</div>}
      {r?.ok && r.errors.map(e => <div key={e} className="warnmsg">Bloc ignoré : {e}</div>)}
      {blocks.length > 0 && (
        <>
          <div className="tscroll"><table className="data addon-match">
            <thead><tr><th>Perso en jeu</th><th className="col-when">Relevé</th><th>Fiche du site</th></tr></thead>
            <tbody>{blocks.map(d => (
              <tr key={key(d)}>
                <td className="with-icon">{d.cls && <ClassIcon cls={d.cls} size={20} />}<span><strong>{d.name}</strong> <span className="muted small">niv. {d.level}{d.cls ? ` · ${d.cls}` : ""} · {d.realm}</span></span></td>
                <td className="small muted col-when">{new Date(d.time * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                <td>
                  <select aria-label={`Fiche pour ${d.name}`} value={targetOf(d)} onChange={e => setTargets(s => ({ ...s, [key(d)]: e.target.value }))}>
                    {mine.map(c => <option key={c.id} value={c.id} disabled={!!(d.cls && c.cls && c.cls !== d.cls)}>{c.name}{c.cls ? ` (${c.cls})` : ""}</option>)}
                    <option value="new">Créer une fiche « {d.name} »</option>
                    <option value="skip">Ignorer</option>
                  </select>
                </td>
              </tr>
            ))}</tbody>
          </table></div>
          <div className="ai-parts">
            {PARTS.map(([k, label]) => (
              <label key={k} className="ai-part"><input type="checkbox" checked={parts.has(k)} onChange={() => toggle(k)} /><span>{label}</span></label>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn primary" disabled={busy || !parts.size} onClick={() => void apply()}>
              {busy ? "Mise à jour…" : `Mettre à jour ${blocks.filter(d => targetOf(d) !== "skip").length} perso${blocks.length > 1 ? "s" : ""}`}
            </button>
            <span className="hint">L'objectif BiS, les intitulés de spé, l'off-spec et les notes ne sont pas modifiés.</span>
          </div>
        </>
      )}
      {results && (
        <ul className="addon-results" role="status">
          {results.map(x => <li key={x.name} className={x.ok ? "ok" : "bad"}><strong>{x.name}</strong> : {x.msg}</li>)}
          {results.length === 0 && <li>Aucun perso mis à jour.</li>}
        </ul>
      )}
    </Step>
  );
}

const COMMANDS: [string, string][] = [
  ["/fr", "Ouvrir ou fermer la fenêtre (comme le bouton de la minicarte)"],
  ["/fr raids · compo · patrons · export", "Ouvrir directement un onglet"],
  ["/fr cherche + Maj+clic sur un objet", "Marquer un patron vu ailleurs (hôtel des ventes, chat) comme recherché, ou l'en retirer"],
  ["/fr oublier Nom-Royaume", "Retirer de l'export un perso supprimé"],
  ["/fr minicarte", "Afficher ou masquer le bouton de la minicarte"],
];

function Commands() {
  return (
    <Step n={4} title="En jeu">
      <ul className="addon-list">
        <li><strong>Raids</strong> : raids à venir de tes groupes, inscription du perso connecté (envoyée avec l'export).</li>
        <li><strong>Compo</strong> : colle l'« Export pour le jeu » de la page d'un raid, puis <em>Inviter</em> et <em>Placer les groupes</em>.</li>
        <li><strong>Patrons</strong> : patrons et BiS suivis présents dans tes sacs (<em>Annoncer</em>), autres patrons à marquer recherchés.</li>
        <li><strong>Export</strong> : texte de tous tes persos, à coller ci-dessus.</li>
        <li><strong>Infobulles et butin</strong> : « Recherché par », « Connu par », « BiS de » sur les objets suivis ; alerte avec <em>Annoncer au groupe</em> quand tu en ramasses un.</li>
      </ul>
      <table className="data">
        <tbody>{COMMANDS.map(([c, d]) => <tr key={c}><td><code>{c}</code></td><td>{d}</td></tr>)}</tbody>
      </table>
    </Step>
  );
}

