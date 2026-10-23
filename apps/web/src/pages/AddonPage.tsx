import { ExternalLink } from "../components/ExternalLink";
import { useSite } from "../site";

declare const __ADDON_VERSION__: string;
declare const __ADDON_SHA256__: string;
/** Addon Roster (WoW Retail, lot R3) : version et empreinte du zip, lues à la construction du site. */
declare const __ROSTER_ADDON_VERSION__: string;
declare const __ROSTER_ADDON_SHA256__: string;

/**
 * Page Addon de Forever Roster (refonte du 23/10) : installer en trois étapes ; la synchro au quotidien, les commandes en jeu
 * et la sécurité sont repliées (le geste de la synchro est aussi dans la flèche de « Copier pour le jeu »).
 * Sur Roster : l'addon Roster, pour WoW Retail.
 */
export function AddonPage() {
  const site = useSite();
  if (site.game === "retail") return <RosterAddonPage />;
  const K = ({ k }: { k: string[] }) => <>{k.map((x, i) => <span key={x}>{i > 0 && "+"}<kbd>{x}</kbd></span>)}</>;
  return (
    <div className="stack ad" style={{ gap: 16 }}>
      <div className="page-head"><div className="ph-t"><span className="eyebrow">Addon Forever Roster</span><h1>Installer l'addon</h1></div></div>
      <div className="alert info ad-pc">L'addon s'installe sur ton PC : ouvre cette page sur ton ordinateur.</div>
      <ol className="ad-steps">
        <li className="ad-step"><h2><span className="n">1</span>Télécharger</h2>
          <p><a className="btn primary" href="/downloads/ForeverRoster.zip" download>Télécharger l'addon {__ADDON_VERSION__}</a></p>
          <p>Un zip de fichiers texte, pour WoW Forever.</p></li>
        <li className="ad-step"><h2><span className="n">2</span>Installer</h2>
          <p>Copie le dossier <code>ForeverRoster</code> dans <code>World of Warcraft\_classic_\Interface\AddOns</code>, puis relance le jeu.</p></li>
        <li className="ad-step"><h2><span className="n">3</span>Choisir ta touche</h2>
          <p>En jeu : <code>/fr options</code>, « Choisir une touche ». Elle sert à la synchro, dans les deux sens.</p></li>
      </ol>
      <details className="ad-more">
        <summary>Synchroniser au quotidien</summary>
        <div className="stack" style={{ padding: "0 14px 14px", gap: 6 }}>
          <p style={{ margin: 0 }}>Du site vers le jeu : « Copier pour le jeu », puis en jeu ta touche et <K k={["Ctrl", "V"]} />.</p>
          <p style={{ margin: 0 }}>Du jeu vers le site : ta touche et <K k={["Ctrl", "C"]} />, puis <K k={["Ctrl", "V"]} /> sur n'importe quelle page du site.</p>
        </div>
      </details>
      <details className="ad-more">
        <summary>Commandes en jeu ({COMMANDS.length})</summary>
        <div className="tscroll" style={{ padding: "0 14px 14px" }}><table className="data">
          <tbody>{COMMANDS.map(([c, d]) => <tr key={c}><td><code>{c}</code></td><td>{d}</td></tr>)}</tbody>
        </table></div>
      </details>
      <details className="ad-more">
        <summary>Sécurité : ce que fait (et ne fait pas) l'addon</summary>
        <ul className="addon-list" style={{ padding: "0 14px 14px 32px", margin: 0 }}>
          <li>Le zip ne contient que des fichiers texte (<code>.lua</code>, <code>.toc</code>, <code>.xml</code>) et la police des titres du site (licence libre OFL) : rien à installer ni à lancer sur ton PC.</li>
          <li>Un addon tourne dans le jeu, sans accès à internet, à tes fichiers ou à ton compte : les échanges passent uniquement par ton copier-coller.</li>
          <li>Il n'envoie rien dans le chat sans un clic de ta part et n'agit pas à ta place en combat.</li>
          <li>Le code est public : <ExternalLink href="https://github.com/Sleyvazh/forever-roster/tree/main/addon/ForeverRoster">addon/ForeverRoster sur GitHub</ExternalLink>.</li>
          {__ADDON_SHA256__ && <li>Empreinte SHA-256 du zip (PowerShell : <code>Get-FileHash ForeverRoster.zip</code>) : <code className="sha">{__ADDON_SHA256__}</code></li>}
        </ul>
      </details>
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

const COMMANDS: [string, string][] = [
  ["Ta touche de synchro", "Synchro rapide : ton export déjà sélectionné (Ctrl+C), ou tu y colles les données du site (Ctrl+V)."],
  ["/fr", "Ouvrir ou fermer la fenêtre (clic droit sur le bouton de la minicarte : synchro rapide)"],
  ["/fr synchro · raids · enraid · compo · patrons · options", "Ouvrir directement un onglet"],
  ["/fr butin · /fr boss · /fr conso", "Maître du butin, fiche du boss, appel aux consommables (en raid)"],
  ["/fr test", "Raid d'essai avec 9 joueurs fictifs, sans rien envoyer"],
  ["/fr habillage", "Habillage du jeu ou du site (recharge l'interface)"],
  ["/fr cherche + Maj+clic sur un objet", "Marquer un patron comme recherché, ou l'en retirer"],
];

/* ---------- Roster (WoW Retail) : l'addon Roster ---------- */

function RosterAddonPage() {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head"><div><div className="eyebrow">Addon Roster</div><h1>Le jeu et le site</h1></div></div>
      <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
        L'addon Roster est fait pour WoW Retail (Midnight, 12.1). Un addon n'a pas accès à internet : les échanges passent par un copier-coller,
        réduit au minimum. Roster Companion, l'appli qui fait la synchro toute seule, n'est pas encore disponible pour Roster.
      </p>
      <div className="addon-steps">
        <RosterInstall />
        <RosterBefore />
        <RosterAfter />
      </div>
    </div>
  );
}

function RosterInstall() {
  return (
    <Step n={1} title="Installer l'addon">
      <div className="row">
        <a className="btn primary" href="/downloads/Roster.zip" download>Télécharger l'addon Roster {__ROSTER_ADDON_VERSION__}</a>
        <span className="muted small">WoW Retail 12.1 (interfaces 120100 et 120105)</span>
      </div>
      <ol className="addon-list">
        <li>Ouvre le zip et copie le dossier <code>Roster</code> dans <code>World of Warcraft\_retail_\Interface\AddOns\</code>. Remplace l'ancien dossier s'il existe.</li>
        <li>Relance le jeu, ou tape <code>/reload</code>.</li>
        <li>Tape <code>/roster</code> pour ouvrir la fenêtre de l'addon.</li>
      </ol>
      <details className="addon-safety">
        <summary>Sécurité : ce que fait (et ne fait pas) l'addon</summary>
        <ul className="addon-list">
          <li>Le zip ne contient que des fichiers texte (<code>.lua</code>, <code>.toc</code>), le logo de l'addon et la police des titres du site (<code>Fonts/MarcellusSC.ttf</code>, licence libre OFL, lue par le jeu) : aucun programme à installer ni à lancer sur ton PC.</li>
          <li>Un addon tourne dans le jeu, sans accès à internet, à tes fichiers ou à ton compte : il ne connaît ni ton mot de passe, ni ta session sur le site. Les échanges passent uniquement par ton copier-coller.</li>
          <li>Le code est public : <ExternalLink href="https://github.com/Sleyvazh/forever-roster/tree/main/addon/Roster">addon/Roster sur GitHub</ExternalLink>.</li>
          {__ROSTER_ADDON_SHA256__ && <li>Empreinte SHA-256 du zip, pour vérifier qu'il est intact (PowerShell : <code>Get-FileHash Roster.zip</code>) : <code className="sha">{__ROSTER_ADDON_SHA256__}</code></li>}
        </ul>
      </details>
    </Step>
  );
}

function RosterBefore() {
  return (
    <Step n={2} title="Avant le raid : du site vers le jeu">
      <ul className="addon-list">
        <li><strong>Raids à venir et inscriptions</strong> : <strong>Copier pour le jeu</strong>, en haut de chaque page ; en jeu, <code>/roster</code>, onglet <strong>Synchro</strong> (ou la synchro rapide de l'addon), puis Ctrl+V. C'est chargé : l'addon connaît les raids de tes guildes, leur difficulté et ton perso inscrit.</li>
        <li><strong>Chef de raid : la compo</strong> : sur la page du raid, onglet <strong>Compo</strong>, « Export pour le jeu ». Colle ce texte dans l'onglet Synchro (ou Compo) de l'addon : invitations et placement des groupes se font depuis l'addon. Les noms sont en <code>Prénom-Royaume</code>, comme dans le jeu ; des macros <code>/inv Prénom-Royaume</code> sont aussi proposées.</li>
        <li><strong>Butin</strong> : pour un raid en mode « Conseil (distribution par Roster) », le même texte apporte le conseil du butin (les officiers, ou celui choisi dans l'onglet <strong>Butin</strong> du raid) et les objets reçus de chacun (colonne « Reçus », avec le détail BiS, Upgrade et jets MS).</li>
        <li>Copie à nouveau après un changement sur le site (nouveau raid, inscription, compo, conseil) : le texte se régénère à chaque fois.</li>
      </ul>
    </Step>
  );
}

function RosterAfter() {
  return (
    <Step n={3} title="Après le raid : le bilan sur le site">
      <ul className="addon-list">
        <li><strong>Pendant le raid</strong> (raid chargé en jeu, de 2 h avant l'heure prévue à 3 h après), l'addon note chaque minute qui est dans le raid, le butin épique vu dans le chat et chaque boss tenté, vaincu ou non.</li>
        <li><strong>Distribution du butin</strong> (raid en mode « Conseil ») : chacun passe sur le butin de groupe, le chef de butin (le chef de raid, sauf autre choix) reçoit les objets, puis attribue chaque objet d'un clic : conseil (BiS, Upgrade, Off-Spec, Transmo, votes du conseil), jets MS / OS ou jet libre ; il peut aussi le garder. L'échange se fait en jeu ; le bilan note qui a reçu quoi, et comment. Pour essayer seul, hors groupe : <code>/roster test</code> (raid d'essai avec 9 joueurs fictifs, rien ne part au raid ni au site).</li>
        <li><strong>Après le raid</strong> : synchro rapide de l'addon, Ctrl+C, puis <strong>Ctrl+V sur n'importe quelle page</strong> de Roster. Le bilan apparaît dans l'onglet <strong>Bilan</strong> du raid (présence, butin, boss vaincus) et dans l'onglet <strong>Présence &amp; butin</strong> de la guilde. Seul un officier de la guilde (ou le créateur du raid) l'enregistre ; un nouveau collage remplace le précédent.</li>
        <li><strong>Tes persos</strong> viennent de Battle.net (<em>Mes persos</em>, « Importer depuis Battle.net ») ou se créent à la main : l'addon Roster ne les envoie pas. Ils sont reconnus dans le bilan à leur nom et à leur royaume.</li>
        <li>Chaque addon va avec son site : un texte de l'addon Forever Roster collé sur Roster (ou l'inverse) est refusé, avec un message.</li>
      </ul>
    </Step>
  );
}
