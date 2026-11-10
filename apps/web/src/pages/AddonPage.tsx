import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get, type Character } from "../api";
import { useMe } from "../auth";
import { ExternalLink } from "../components/ExternalLink";
import { useMyGuilds } from "../nav";
import { useSite } from "../site";
import { openSync } from "../syncPanel";

declare const __ADDON_VERSION__: string;
declare const __ADDON_SHA256__: string;
/** Addon Roster (WoW Retail, lot R3) : version et empreinte du zip, lues à la construction du site. */
declare const __ROSTER_ADDON_VERSION__: string;
declare const __ROSTER_ADDON_SHA256__: string;
/** Dernier installateur de Roster Companion : copie au nom fixe dans chaque GitHub Release (scripts/companion-release.mjs). */
const COMPANION_URL = "https://github.com/Sleyvazh/forever-roster/releases/latest/download/Roster-Companion-setup.exe";

/** « 1.6.10 » plus récent que « 1.6.9 » : comparaison nombre par nombre. */
export function newerVersion(a: string, b: string) {
  const x = a.split(".").map(n => parseInt(n, 10) || 0), y = b.split(".").map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
  return false;
}
/** Depuis la 1.6.5 (8/11), le site refuse les textes de l'addon sans sceau. */
const SEALED_SINCE = "1.6.5";
const ADDONS_PATH = "World of Warcraft\\_forever_\\Interface\\AddOns";
const DAY = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short" });

/**
 * Page Addon de Forever Roster (refonte du 09/11, maquette-addon.png) : ton état en tête (version d'après ta dernière synchro,
 * « ● Mise à jour 1.6.6 disponible » et la conséquence, « Télécharger l'addon » doré, ou « ✓ à jour ») ; deux étapes,
 * Installer (chemin à copier) et Choisir ta touche (la synchro passe ensuite par le bouton Synchro) ; Roster Companion en ligne
 * discrète « facultatif » pour les membres, en carte « recommandé pour toi » pour les officiers ; commandes et sécurité repliées.
 * Sur Roster : l'addon Roster, pour WoW Retail.
 */
export function AddonPage() {
  const site = useSite();
  if (site.game === "retail") return <RosterAddonPage />;
  return <ForeverAddonPage />;
}

function ForeverAddonPage() {
  const me = useMe();
  const mine = me.data?.user?.addonVersion ?? null;
  const officer = (useMyGuilds().data?.groups ?? []).some(g => g.role !== "member");
  const chars = useQuery({ queryKey: ["characters"], queryFn: () => get<{ characters: Character[] }>("/characters"), enabled: !!me.data?.user }).data?.characters ?? [];
  const lastSync = chars.map(c => c.addonSyncedAt).filter((x): x is string => !!x).sort().at(-1) ?? null;
  const latest = __ADDON_VERSION__;
  const old = !!mine && newerVersion(latest, mine);
  const unsealed = !!mine && newerVersion(SEALED_SINCE, mine);
  const [copied, setCopied] = useState(false);
  const download = (primary: boolean) => <a className={`btn${primary ? " primary" : ""} ad-dl`} href="/downloads/ForeverRoster.zip" download>Télécharger l'addon {latest}</a>;
  const companion = <a className="btn" href={COMPANION_URL}>Télécharger Roster Companion</a>;
  return (
    <div className="stack ad" style={{ gap: 16 }}>
      <div className="page-head"><div className="ph-t"><span className="eyebrow">Addon Forever Roster</span><h1>Installer l'addon</h1></div></div>
      <div className="alert info ad-pc">L'addon s'installe sur ton PC : ouvre cette page sur ton ordinateur.</div>
      <section className={`ad-state${old || !mine ? " todo" : " ok"}`} aria-label="Ton addon">
        <div className="ad-state-t">
          {mine ? <>
            <span>Ton addon, d'après ta synchro{lastSync ? ` du ${DAY.format(new Date(lastSync))}` : ""}</span>
            <span className="ad-ver"><b className="num">{mine}</b>{old ? <span className="ad-up">● Mise à jour {latest} disponible</span> : <span className="ad-ok">✓ à jour</span>}</span>
            {old && <span>{unsealed ? `Sans la ${latest}, le site refuse tes persos et tes relevés (textes non scellés).` : `La ${latest} apporte les dernières nouveautés : remplace le dossier de l'addon.`}</span>}
          </> : <>
            <span className="ad-ver"><b>Pas encore d'addon sur ce compte</b></span>
            <span>Version {latest}, pour WoW Forever : un zip de fichiers texte.</span>
          </>}
        </div>
        {old || !mine ? download(true) : download(false)}
      </section>
      <ol className="ad-steps two">
        <li className="ad-step"><h2><span className="n">1</span>Installer</h2>
          <p>Dézippe et remplace le dossier <b>ForeverRoster</b> dans :</p>
          <div className="ad-path">
            <code>{ADDONS_PATH}</code>
            <button type="button" className="btn" onClick={() => { void navigator.clipboard.writeText(ADDONS_PATH).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? "Copié" : "Copier le chemin"}</button>
          </div>
          <p>puis relance le jeu.</p></li>
        <li className="ad-step"><h2><span className="n">2</span>Choisir ta touche de synchro</h2>
          <p>En jeu : <code>/fr options</code> › Touches › Synchro rapide.</p>
          <p>Ensuite, la synchro se fait avec le bouton <button type="button" className="link" onClick={openSync}>⟳ Synchro</button> en haut de chaque page du site.</p></li>
      </ol>
      {officer ? (
        <section className="ad-app rec" aria-labelledby="ad-app-t">
          <div className="stack" style={{ gap: 4 }}>
            <h2 id="ad-app-t">Roster Companion · recommandé pour toi</h2>
            <p>Tu es officier : avec l'appli, toute la guilde reçoit les données du site sans copier-coller, et les inscriptions faites en jeu arrivent sur le site.</p>
            <p className="ad-warn">Windows peut afficher « Windows a protégé votre ordinateur » : « Informations complémentaires », puis « Exécuter quand même ». L'appli te donne ensuite un code à valider sur le site.</p>
          </div>
          {companion}
        </section>
      ) : (
        <details className="ad-more ad-line">
          <summary><b>Roster Companion</b> <span className="ad-opt">facultatif</span> <span>L'appli de synchro automatique, surtout utile aux officiers : un ou deux suffisent pour toute la guilde.</span> <span className="ad-more-l">En savoir plus ›</span></summary>
          <div className="stack" style={{ padding: "0 14px 14px", gap: 8 }}>
            <p style={{ margin: 0 }}>L'appli Windows fait la synchro toute seule, sans copier-coller, et se met à jour toute seule. Les officiers qui l'ont transmettent les données à toute la guilde par l'addon.</p>
            <p className="ad-warn" style={{ margin: 0 }}>Windows peut afficher « Windows a protégé votre ordinateur » : « Informations complémentaires », puis « Exécuter quand même ».</p>
            <div>{companion}</div>
          </div>
        </details>
      )}
      <details className="ad-more">
        <summary>Commandes en jeu · {COMMANDS.length}</summary>
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
  ["/fr accueil · raids · sorties · synchro · patrons · options", "Ouvrir directement une page (aussi enraid et compo)"],
  ["/fr butin · /fr boss · /fr conso", "Maître du butin, fiche du boss, appel aux consommables (en raid)"],
  ["/fr test", "Raid d'essai avec 9 joueurs fictifs, sans rien envoyer"],
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
        <li><strong>Raids à venir et inscriptions</strong> : bouton <strong>Synchro</strong> en haut de chaque page, <strong>Copier pour le jeu</strong> ; en jeu, <code>/roster</code>, onglet <strong>Synchro</strong> (ou la synchro rapide de l'addon), puis Ctrl+V. C'est chargé : l'addon connaît les raids de tes guildes, leur difficulté et ton perso inscrit.</li>
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
