import { parseCharacterExports, type CharacterExport } from "@forever/game-data";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { get, type Character } from "../api";
import { ALL_PARTS, applyBlocks, blockKey, blockSummary, guessTarget, PARTS, syncAge, type ApplyResult, type Part, type Target } from "../addonImport";
import { copyGameData } from "../components/CopyForGame";
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
        Un addon n'a pas accès à internet : les échanges passent par un copier-coller, réduit au minimum. Avant de jouer :
        « Copier pour le jeu » en haut du site, ta touche de synchro en jeu, Ctrl+V. Après : ta touche, Ctrl+C, puis Ctrl+V sur n'importe quelle page du site. La petite fenêtre de synchro se ferme toute seule.
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
        <li>Choisis ta touche de synchro : <strong>Échap &gt; Options &gt; Raccourcis &gt; AddOns &gt; Forever Roster</strong>. Sinon : le livre autour de la minicarte (clic droit : synchro) ou <code>/fr</code>.</li>
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
  const [data, setData] = useState<Awaited<ReturnType<typeof copyGameData>> | null>(null);
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  const copy = async () => {
    try { setData(await copyGameData()); setState("ok"); } catch { setState("err"); }
  };
  return (
    <Step n={2} title="Du site vers le jeu : mes groupes">
      <p className="hint" style={{ margin: 0 }}>
        Raids à venir (pour t'inscrire en jeu), patrons recherchés ou connus et objets BiS recherchés par les persos de tes groupes :
        infobulles en jeu, liste des sacs et alerte quand tu ramasses l'un d'eux. Le bouton <strong>Copier pour le jeu</strong> est aussi
        en haut de chaque page.
      </p>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => void copy()}>{state === "ok" ? "Copié" : "Copier pour le jeu"}</button>
        {state === "err" && <span className="warnmsg">Copie impossible : réessaie.</span>}
      </div>
      {data && (
        <>
          {data.groups.length === 0 ? <p className="muted">Tu n'es dans aucun groupe.</p> : (
            <ul className="addon-groups">
              {data.groups.map(g => (
                <li key={g.name}><strong>{g.name}</strong> <span className="muted small">· {g.raids} raid{g.raids > 1 ? "s" : ""} à venir · {g.patterns} patron{g.patterns > 1 ? "s" : ""} · {g.bis} BiS</span></li>
              ))}
            </ul>
          )}
          <textarea id="ga-all" readOnly className="num" aria-label="Données de mes groupes pour l'addon" rows={Math.min(6, data.text.split("\n").length)} value={data.text} onFocus={e => e.currentTarget.select()} />
        </>
      )}
      <p className="hint" style={{ margin: 0 }}>En jeu : ta touche de synchro (ou clic droit sur le bouton de la minicarte), puis Ctrl+V : c'est chargé tout seul.</p>
    </Step>
  );
}

function FromGame() {
  const qc = useQueryClient();
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters") });
  const [text, setText] = useState("");
  const [targets, setTargets] = useState<Record<string, Target>>({});
  const [parts, setParts] = useState<Set<Part>>(new Set(ALL_PARTS));
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const r = text.trim() ? parseCharacterExports(text) : null;
  const blocks = r?.ok ? r.data : [];
  const mine = chars.data?.characters ?? [];
  const targetOf = (d: CharacterExport) => targets[blockKey(d)] ?? guessTarget(d, mine);
  const toggle = (p: Part) => setParts(s => { const n = new Set(s); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const apply = async () => {
    setBusy(true);
    const out = await applyBlocks(blocks, targetOf, parts, mine);
    await Promise.all([qc.invalidateQueries({ queryKey: ["characters"] }), qc.invalidateQueries({ queryKey: ["char-recipes"] }), qc.invalidateQueries({ queryKey: ["raids"] })]);
    setResults(out); setText(""); setTargets({}); setBusy(false);
  };

  return (
    <Step n={3} title="Du jeu vers le site : mettre à jour mes persos">
      <p className="hint" style={{ margin: 0 }}>
        En jeu : ta touche de synchro, Ctrl+C (la fenêtre se ferme toute seule). Puis ici, <strong>sur n'importe quelle page du site, Ctrl+V</strong> suffit : une fenêtre
        te propose la mise à jour. Seuls les persos qui ont changé depuis ton dernier envoi sont dans l'export.
      </p>
      {mine.length > 0 && (
        <ul className="addon-sync">
          {mine.map(c => {
            const age = syncAge(c.addonSyncedAt);
            return <li key={c.id}><span className="with-icon">{c.cls && <ClassIcon cls={c.cls} size={18} />}<span>{c.name}</span></span><span className={`small ${age.stale ? "stale" : "fresh"}`}>{age.text}</span></li>;
          })}
        </ul>
      )}
      <details className="addon-safety">
        <summary>Coller ici à la place</summary>
        <div className="stack" style={{ gap: 10, marginTop: 10 }}>
          <textarea id="addon-import-all" aria-label="Texte exporté par l'addon" rows={4} spellCheck={false} placeholder="FRC;2;…" value={text}
            onChange={e => { setText(e.target.value); setResults(null); }} />
          {r && !r.ok && <div className="warnmsg">{r.error}</div>}
          {r?.ok && r.errors.map(e => <div key={e} className="warnmsg">Bloc ignoré : {e}</div>)}
          {blocks.length > 0 && (
            <>
              <div className="tscroll"><table className="data addon-match">
                <thead><tr><th>Perso en jeu</th><th className="col-when">Relevé</th><th>Fiche du site</th></tr></thead>
                <tbody>{blocks.map(d => (
                  <tr key={blockKey(d)}>
                    <td className="with-icon">{d.cls && <ClassIcon cls={d.cls} size={20} />}<span><strong>{d.name}</strong> <span className="muted small">{blockSummary(d)}</span></span></td>
                    <td className="small muted col-when">{new Date(d.time * 1000).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td>
                      <select aria-label={`Fiche pour ${d.name}`} value={targetOf(d)} onChange={e => setTargets(s => ({ ...s, [blockKey(d)]: e.target.value }))}>
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
        </div>
      </details>
      {results && <AddonResults results={results} />}
    </Step>
  );
}

export function AddonResults({ results }: { results: ApplyResult[] }) {
  return (
    <ul className="addon-results" role="status">
      {results.map(x => <li key={x.name} className={x.ok ? "ok" : "bad"}><strong>{x.name}</strong> : {x.msg}</li>)}
      {results.length === 0 && <li>Aucun perso mis à jour.</li>}
    </ul>
  );
}

const COMMANDS: [string, string][] = [
  ["Ta touche de synchro", "Échap > Options > Raccourcis > AddOns > Forever Roster : « Synchro rapide avec le site » : une seule case, ton export déjà sélectionné (Ctrl+C) ou tu y colles les données du site (Ctrl+V). Aussi « Ouvrir ou fermer la fenêtre »"],
  ["/fr", "Ouvrir ou fermer la fenêtre (comme le bouton de la minicarte ; clic droit : synchro rapide)"],
  ["/fr synchro · raids · compo · patrons", "Ouvrir directement un onglet"],
  ["/fr cherche + Maj+clic sur un objet", "Marquer un patron vu ailleurs (hôtel des ventes, chat) comme recherché, ou l'en retirer"],
  ["/fr oublier Nom-Royaume", "Retirer de l'export un perso supprimé"],
  ["/fr rappels", "Couper ou remettre le rappel de raid à la connexion (raid des prochaines 24 h sans réponse : « Tu viens ? »)"],
  ["/fr minicarte", "Afficher ou masquer le bouton de la minicarte"],
];

function Commands() {
  return (
    <Step n={4} title="En jeu">
      <ul className="addon-list">
        <li><strong>Synchro</strong> : en haut, colle ce que tu as copié sur le site (chargé tout seul, compo d'un raid comprise) ; en bas, ton export déjà sélectionné : Ctrl+C, Échap. Le bouton de la minicarte affiche combien de persos ont changé.</li>
        <li><strong>Raids</strong> : raids à venir de tes groupes, inscription du perso connecté (envoyée avec l'export).</li>
        <li><strong>Compo</strong> : la compo collée depuis la page d'un raid, avec <em>Inviter</em> et <em>Placer les groupes</em>.</li>
        <li><strong>Patrons</strong> : patrons et BiS suivis présents dans tes sacs (<em>Annoncer</em>), autres patrons à marquer recherchés.</li>
        <li><strong>Infobulles et butin</strong> : « Recherché par », « Connu par », « BiS de » sur les objets suivis ; alerte avec <em>Annoncer au groupe</em> quand tu en ramasses un.</li>
      </ul>
      <table className="data">
        <tbody>{COMMANDS.map(([c, d]) => <tr key={c}><td><code>{c}</code></td><td>{d}</td></tr>)}</tbody>
      </table>
    </Step>
  );
}
