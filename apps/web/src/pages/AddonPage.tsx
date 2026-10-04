import { useQuery } from "@tanstack/react-query";
import { get, type Character } from "../api";
import { syncAge } from "../addonImport";
import { ClassIcon } from "../components/Icons";

declare const __ADDON_VERSION__: string;
declare const __ADDON_SHA256__: string;

/**
 * Page Addon : installer l'addon, comprendre la synchro (le copier et le coller se font depuis n'importe quelle page),
 * et ce que fait l'addon en jeu.
 */
export function AddonPage() {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head"><div><div className="eyebrow">Addon Forever Roster</div><h1>Le jeu et le site</h1></div></div>
      <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
        Un addon n'a pas accès à internet : les échanges passent par un copier-coller, réduit au minimum.
      </p>
      <div className="addon-steps">
        <Install />
        <Sync />
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
        <li>Choisis ta touche de synchro : <code>/fr options</code>, « Choisir une touche » (ou Échap &gt; Options &gt; Raccourcis &gt; AddOns &gt; Forever Roster). Sans touche : clic droit sur le bouton de la minicarte.</li>
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

function Sync() {
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters") });
  const mine = chars.data?.characters ?? [];
  return (
    <Step n={2} title="Synchroniser">
      <ul className="addon-list">
        <li><strong>Du site vers le jeu</strong> (raids à venir, patrons et BiS suivis par tes groupes) : <strong>Copier pour le jeu</strong>, en haut de chaque page ; en jeu, ta touche de synchro puis Ctrl+V. C'est chargé, et la fenêtre se ferme toute seule.</li>
        <li><strong>Du jeu vers le site</strong> (équipement, métiers, patrons, talents, inscriptions) : en jeu, ta touche de synchro puis Ctrl+C ; sur le site, <strong>Ctrl+V sur n'importe quelle page</strong>. Une fenêtre te propose la mise à jour de tes persos. Seuls ceux qui ont changé depuis ton dernier envoi sont dans l'export.</li>
      </ul>
      {mine.length > 0 && (
        <>
          <h3 className="addon-sub">Dernière synchro de tes persos</h3>
          <ul className="addon-sync">
            {mine.map(c => {
              const age = syncAge(c.addonSyncedAt);
              return <li key={c.id}><span className="with-icon">{c.cls && <ClassIcon cls={c.cls} size={18} />}<span>{c.name}</span></span><span className={`small ${age.stale ? "stale" : "fresh"}`}>{age.text}</span></li>;
            })}
          </ul>
        </>
      )}
    </Step>
  );
}

const COMMANDS: [string, string][] = [
  ["Ta touche de synchro", "« Synchro rapide avec le site » : une seule case, ton export déjà sélectionné (Ctrl+C) ou tu y colles les données du site (Ctrl+V). À choisir dans l'onglet Options de l'addon."],
  ["/fr", "Ouvrir ou fermer la fenêtre (comme le bouton de la minicarte ; clic droit : synchro rapide)"],
  ["/fr synchro · raids · compo · patrons · options", "Ouvrir directement un onglet"],
  ["/fr cherche + Maj+clic sur un objet", "Marquer un patron vu ailleurs (hôtel des ventes, chat) comme recherché, ou l'en retirer"],
];

function Commands() {
  return (
    <Step n={3} title="En jeu">
      <ul className="addon-list">
        <li><strong>Synchro</strong> : en haut, colle ce que tu as copié sur le site (chargé tout seul, compo d'un raid comprise) ; en bas, ton export déjà sélectionné : Ctrl+C. Le bouton de la minicarte affiche combien de persos ont changé.</li>
        <li><strong>Raids</strong> : raids à venir de tes groupes, inscription du perso connecté (envoyée avec la synchro). À la connexion, un raid des prochaines 24 h sans réponse te demande « Tu viens ? ».</li>
        <li><strong>Compo</strong> : la compo collée depuis la page d'un raid, avec <em>Inviter</em> et <em>Placer les groupes</em>.</li>
        <li><strong>Patrons</strong> : patrons et BiS suivis présents dans tes sacs (<em>Annoncer</em>), autres patrons à marquer recherchés.</li>
        <li><strong>Présence et butin</strong> : pendant un raid prévu sur le site, l'addon note chaque minute qui est dans le raid, et le butin épique (« REC » sur le bouton de la minicarte). Le bilan part avec la synchro ; le site retient celui d'un officier du groupe.</li>
        <li><strong>Options</strong> : tes touches, le bouton de la minicarte, le rappel de raid, et les persos à retirer de l'export.</li>
        <li><strong>Infobulles et butin</strong> : « Recherché par », « Connu par », « BiS de » sur les objets suivis ; alerte avec <em>Annoncer au groupe</em> quand tu en ramasses un.</li>
      </ul>
      <table className="data">
        <tbody>{COMMANDS.map(([c, d]) => <tr key={c}><td><code>{c}</code></td><td>{d}</td></tr>)}</tbody>
      </table>
    </Step>
  );
}
