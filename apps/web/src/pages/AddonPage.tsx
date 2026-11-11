import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { get, type Character } from "../api";
import { useMe } from "../auth";
import { ExternalLink } from "../components/ExternalLink";
import { useMyGuilds } from "../nav";
import { useSite } from "../site";
import { openSync } from "../syncPanel";
import { dateLocale, N, t, tx } from "../i18n";

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
const shortDay = (iso: string) => new Intl.DateTimeFormat(dateLocale(), { day: "numeric", month: "short" }).format(new Date(iso));

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
  const download = (primary: boolean) => <a className={`btn${primary ? " primary" : ""} ad-dl`} href="/downloads/ForeverRoster.zip" download>{tx("Télécharger l'addon {latest}", { latest: latest })}</a>;
  const companion = <a className="btn" href={COMPANION_URL}>{t("Télécharger Roster Companion")}</a>;
  return (
    <div className="stack ad" style={{ gap: 16 }}>
      <div className="page-head"><div className="ph-t"><span className="eyebrow">{t("Addon Forever Roster")}</span><h1>{t("Installer l'addon")}</h1></div></div>
      <div className="alert info ad-pc">{t("L'addon s'installe sur ton PC : ouvre cette page sur ton ordinateur.")}</div>
      <section className={`ad-state${old || !mine ? " todo" : " ok"}`} aria-label={t("Ton addon")}>
        <div className="ad-state-t">
          {mine ? <>
            <span>{t("Ton addon, d'après ta synchro")}{lastSync ? t(" du {date}", { date: shortDay(lastSync) }) : ""}</span>
            <span className="ad-ver"><b className="num">{mine}</b>{old ? <span className="ad-up">{tx("● Mise à jour {latest} disponible", { latest: latest })}</span> : <span className="ad-ok">{t("✓ à jour")}</span>}</span>
            {old && <span>{unsealed ? t("Sans la {latest}, le site refuse tes persos et tes relevés (textes non scellés).", { latest: latest }) : t("La {latest} apporte les dernières nouveautés : remplace le dossier de l'addon.", { latest: latest })}</span>}
          </> : <>
            <span className="ad-ver"><b>{t("Pas encore d'addon sur ce compte")}</b></span>
            <span>{tx("Version {latest}, pour WoW Forever : un zip de fichiers texte.", { latest: latest })}</span>
          </>}
        </div>
        {old || !mine ? download(true) : download(false)}
      </section>
      <ol className="ad-steps two">
        <li className="ad-step"><h2><span className="n">1</span>{t("Installer")}</h2>
          <p>{tx("Dézippe et remplace le dossier {el} dans :", { el: <b>ForeverRoster</b> })}</p>
          <div className="ad-path">
            <code>{ADDONS_PATH}</code>
            <button type="button" className="btn" onClick={() => { void navigator.clipboard.writeText(ADDONS_PATH).then(() => setCopied(true), () => setCopied(false)); }}>{copied ? t("Copié") : t("Copier le chemin")}</button>
          </div>
          <p>{t("puis relance le jeu.")}</p></li>
        <li className="ad-step"><h2><span className="n">2</span>{t("Choisir ta touche de synchro")}</h2>
          <p>{tx("En jeu : {el} › Touches › Synchro rapide.", { el: <code>/fr options</code> })}</p>
          <p>{tx("Ensuite, la synchro se fait avec le bouton {el} en haut de chaque page du site.", { el: <button type="button" className="link" onClick={openSync}>{t("⟳ Synchro")}</button> })}</p></li>
      </ol>
      {officer ? (
        <section className="ad-app rec" aria-labelledby="ad-app-t">
          <div className="stack" style={{ gap: 4 }}>
            <h2 id="ad-app-t">{t("Roster Companion · recommandé pour toi")}</h2>
            <p>{t("Tu es officier : avec l'appli, toute la guilde reçoit les données du site sans copier-coller, et les inscriptions faites en jeu arrivent sur le site.")}</p>
            <p className="ad-warn">{t("Windows peut afficher « Windows a protégé votre ordinateur » : « Informations complémentaires », puis « Exécuter quand même ». L'appli te donne ensuite un code à valider sur le site.")}</p>
          </div>
          {companion}
        </section>
      ) : (
        <details className="ad-more ad-line">
          <summary><b>{t("Roster Companion")}</b> <span className="ad-opt">{t("facultatif")}</span> <span>{t("L'appli de synchro automatique, surtout utile aux officiers : un ou deux suffisent pour toute la guilde.")}</span> <span className="ad-more-l">{t("En savoir plus ›")}</span></summary>
          <div className="stack" style={{ padding: "0 14px 14px", gap: 8 }}>
            <p style={{ margin: 0 }}>{t("L'appli Windows fait la synchro toute seule, sans copier-coller, et se met à jour toute seule. Les officiers qui l'ont transmettent les données à toute la guilde par l'addon.")}</p>
            <p className="ad-warn" style={{ margin: 0 }}>{t("Windows peut afficher « Windows a protégé votre ordinateur » : « Informations complémentaires », puis « Exécuter quand même ».")}</p>
            <div>{companion}</div>
          </div>
        </details>
      )}
      <details className="ad-more">
        <summary>{tx("Commandes en jeu · {length}", { length: COMMANDS.length })}</summary>
        <div className="tscroll" style={{ padding: "0 14px 14px" }}><table className="data">
          <tbody>{COMMANDS.map(([c, d]) => <tr key={c}><td><code>{t(c)}</code></td><td>{t(d)}</td></tr>)}</tbody>
        </table></div>
      </details>
      <details className="ad-more">
        <summary>{t("Sécurité : ce que fait (et ne fait pas) l'addon")}</summary>
        <ul className="addon-list" style={{ padding: "0 14px 14px 32px", margin: 0 }}>
          <li>{tx("Le zip ne contient que des fichiers texte ({el}, {el2}, {el3}) et la police des titres du site (licence libre OFL) : rien à installer ni à lancer sur ton PC.", { el: <code>.lua</code>, el2: <code>.toc</code>, el3: <code>.xml</code> })}</li>
          <li>{t("Un addon tourne dans le jeu, sans accès à internet, à tes fichiers ou à ton compte : les échanges passent uniquement par ton copier-coller.")}</li>
          <li>{t("Il n'envoie rien dans le chat sans un clic de ta part et n'agit pas à ta place en combat.")}</li>
          <li>{tx("Le code est public : {el}.", { el: <ExternalLink href="https://github.com/Sleyvazh/forever-roster/tree/main/addon/ForeverRoster">{t("addon/ForeverRoster sur GitHub")}</ExternalLink> })}</li>
          {__ADDON_SHA256__ && <li>{tx("Empreinte SHA-256 du zip (PowerShell : {el}) :", { el: <code>Get-FileHash ForeverRoster.zip</code> })} <code className="sha">{__ADDON_SHA256__}</code></li>}
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
  [N("Ta touche de synchro"), N("Synchro rapide : ton export déjà sélectionné (Ctrl+C), ou tu y colles les données du site (Ctrl+V).")],
  ["/fr", N("Ouvrir ou fermer la fenêtre (clic droit sur le bouton de la minicarte : synchro rapide)")],
  [N("/fr accueil · raids · sorties · synchro · patrons · options"), N("Ouvrir directement une page (aussi enraid et compo)")],
  [N("/fr butin · /fr boss · /fr conso"), N("Maître du butin, fiche du boss, appel aux consommables (en raid)")],
  ["/fr test", N("Raid d'essai avec 9 joueurs fictifs, sans rien envoyer")],
  [N("/fr cherche + Maj+clic sur un objet"), N("Marquer un patron comme recherché, ou l'en retirer")],
];

/* ---------- Roster (WoW Retail) : l'addon Roster ---------- */

function RosterAddonPage() {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head"><div><div className="eyebrow">{t("Addon Roster")}</div><h1>{t("Le jeu et le site")}</h1></div></div>
      <p className="muted" style={{ margin: 0, maxWidth: 760 }}>
        {t("L'addon Roster est fait pour WoW Retail (Midnight, 12.1). Un addon n'a pas accès à internet : les échanges passent par un copier-coller, réduit au minimum. Roster Companion, l'appli qui fait la synchro toute seule, n'est pas encore disponible pour Roster.")}</p>
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
    <Step n={1} title={t("Installer l'addon")}>
      <div className="row">
        <a className="btn primary" href="/downloads/Roster.zip" download>{tx("Télécharger l'addon Roster {v}", { v: __ROSTER_ADDON_VERSION__ })}</a>
        <span className="muted small">{t("WoW Retail 12.1 (interfaces 120100 et 120105)")}</span>
      </div>
      <ol className="addon-list">
        <li>{tx("Ouvre le zip et copie le dossier {el} dans {el2}. Remplace l'ancien dossier s'il existe.", { el: <code>Roster</code>, el2: <code>World of Warcraft\_retail_\Interface\AddOns\</code> })}</li>
        <li>{tx("Relance le jeu, ou tape {el}.", { el: <code>/reload</code> })}</li>
        <li>{tx("Tape {el} pour ouvrir la fenêtre de l'addon.", { el: <code>/roster</code> })}</li>
      </ol>
      <details className="addon-safety">
        <summary>{t("Sécurité : ce que fait (et ne fait pas) l'addon")}</summary>
        <ul className="addon-list">
          <li>{tx("Le zip ne contient que des fichiers texte ({el}, {el2}), le logo de l'addon et la police des titres du site ({el3}, licence libre OFL, lue par le jeu) : aucun programme à installer ni à lancer sur ton PC.", { el: <code>.lua</code>, el2: <code>.toc</code>, el3: <code>Fonts/MarcellusSC.ttf</code> })}</li>
          <li>{t("Un addon tourne dans le jeu, sans accès à internet, à tes fichiers ou à ton compte : il ne connaît ni ton mot de passe, ni ta session sur le site. Les échanges passent uniquement par ton copier-coller.")}</li>
          <li>{tx("Le code est public : {el}.", { el: <ExternalLink href="https://github.com/Sleyvazh/forever-roster/tree/main/addon/Roster">{t("addon/Roster sur GitHub")}</ExternalLink> })}</li>
          {__ROSTER_ADDON_SHA256__ && <li>{tx("Empreinte SHA-256 du zip, pour vérifier qu'il est intact (PowerShell : {el}) :", { el: <code>Get-FileHash Roster.zip</code> })} <code className="sha">{__ROSTER_ADDON_SHA256__}</code></li>}
        </ul>
      </details>
    </Step>
  );
}

function RosterBefore() {
  return (
    <Step n={2} title={t("Avant le raid : du site vers le jeu")}>
      <ul className="addon-list">
        <li><strong>{t("Raids à venir et inscriptions")}</strong> {tx(": bouton {el} en haut de chaque page, {el2} ; en jeu, {el3}, onglet {el4} (ou la synchro rapide de l'addon), puis Ctrl+V. C'est chargé : l'addon connaît les raids de tes guildes, leur difficulté et ton perso inscrit.", { el: <strong>{t("Synchro")}</strong>, el2: <strong>{t("Copier pour le jeu")}</strong>, el3: <code>/roster</code>, el4: <strong>{t("Synchro")}</strong> })}</li>
        <li><strong>{t("Chef de raid : la compo")}</strong> {tx(": sur la page du raid, onglet {el}, « Export pour le jeu ». Colle ce texte dans l'onglet Synchro (ou Compo) de l'addon : invitations et placement des groupes se font depuis l'addon. Les noms sont en {el2}, comme dans le jeu ; des macros {el3} sont aussi proposées.", { el: <strong>{t("Compo")}</strong>, el2: <code>{t("Prénom-Royaume")}</code>, el3: <code>{t("/inv Prénom-Royaume")}</code> })}</li>
        <li><strong>{t("Butin")}</strong> {tx(": pour un raid en mode « Conseil (distribution par Roster) », le même texte apporte le conseil du butin (les officiers, ou celui choisi dans l'onglet {el} du raid) et les objets reçus de chacun (colonne « Reçus », avec le détail BiS, Upgrade et jets MS).", { el: <strong>{t("Butin")}</strong> })}</li>
        <li>{t("Copie à nouveau après un changement sur le site (nouveau raid, inscription, compo, conseil) : le texte se régénère à chaque fois.")}</li>
      </ul>
    </Step>
  );
}

function RosterAfter() {
  return (
    <Step n={3} title={t("Après le raid : le bilan sur le site")}>
      <ul className="addon-list">
        <li><strong>{t("Pendant le raid")}</strong> {t("(raid chargé en jeu, de 2 h avant l'heure prévue à 3 h après), l'addon note chaque minute qui est dans le raid, le butin épique vu dans le chat et chaque boss tenté, vaincu ou non.")}</li>
        <li><strong>{t("Distribution du butin")}</strong> {tx("(raid en mode « Conseil ») : chacun passe sur le butin de groupe, le chef de butin (le chef de raid, sauf autre choix) reçoit les objets, puis attribue chaque objet d'un clic : conseil (BiS, Upgrade, Off-Spec, Transmo, votes du conseil), jets MS / OS ou jet libre ; il peut aussi le garder. L'échange se fait en jeu ; le bilan note qui a reçu quoi, et comment. Pour essayer seul, hors groupe : {el} (raid d'essai avec 9 joueurs fictifs, rien ne part au raid ni au site).", { el: <code>/roster test</code> })}</li>
        <li><strong>{t("Après le raid")}</strong> {tx(": synchro rapide de l'addon, Ctrl+C, puis {el} de Roster. Le bilan apparaît dans l'onglet {el2} du raid (présence, butin, boss vaincus) et dans l'onglet {el3} de la guilde. Seul un officier de la guilde (ou le créateur du raid) l'enregistre ; un nouveau collage remplace le précédent.", { el: <strong>{t("Ctrl+V sur n'importe quelle page")}</strong>, el2: <strong>{t("Bilan")}</strong>, el3: <strong>{t("Présence & butin")}</strong> })}</li>
        <li><strong>{t("Tes persos")}</strong> {tx("viennent de Battle.net ({el}, « Importer depuis Battle.net ») ou se créent à la main : l'addon Roster ne les envoie pas. Ils sont reconnus dans le bilan à leur nom et à leur royaume.", { el: <em>{t("Mes persos")}</em> })}</li>
        <li>{t("Chaque addon va avec son site : un texte de l'addon Forever Roster collé sur Roster (ou l'inverse) est refusé, avec un message.")}</li>
      </ul>
    </Step>
  );
}
