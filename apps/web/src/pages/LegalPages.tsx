import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "../components/ExternalLink";
import { useSite, type SiteData } from "../site";

/**
 * Mentions légales et politique de confidentialité : pages publiques (sans connexion), sur les deux adresses, avec le
 * nom du site de l'adresse. L'adresse de contact vient du serveur (CONTACT_EMAIL, servie par /api/site).
 * Les durées de conservation décrivent ce que fait le code (purges : apps/api/src/lib/purges.ts) : à mettre à jour avec lui.
 */
const UPDATED = "17 octobre 2026";

const host = (origin: string) => origin.replace(/^https?:\/\//, "");
const gameOf = (game: SiteData["game"]) => (game === "retail" ? "WoW Retail" : "WoW Forever");

function useTitle(title: string) {
  const site = useSite();
  useEffect(() => {
    document.title = `${title} · ${site.name}`;
    return () => { document.title = site.name; };
  }, [title, site.name]);
}

/** Adresse de contact (mailto), « … » tant que le serveur n'a pas répondu. */
function Contact() {
  const { contact } = useSite();
  return contact ? <a href={`mailto:${contact}`}>{contact}</a> : <span className="muted">…</span>;
}

/** « Forever Roster (forever-roster.sleyvazh.fr, pour WoW Forever) et Roster (…) » : l'adresse ouverte d'abord. */
function Sites() {
  const site = useSite();
  const one = (s: { game: SiteData["game"]; name: string; origin: string }) =>
    <><b>{s.name}</b> ({host(s.origin)}, pour {gameOf(s.game)})</>;
  return site.other ? <>{one(site)} et {one(site.other)}</> : one(site);
}

/** Les noms du site : « Forever Roster et Roster », ou un seul. */
const names = (site: SiteData) => (site.other ? `${site.name} et ${site.other.name}` : site.name);

function Sec({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return <section className="panel pad legal-sec" id={id} aria-labelledby={`${id}-t`}><h2 id={`${id}-t`}>{title}</h2>{children}</section>;
}

function Head({ title }: { title: string }) {
  const site = useSite();
  return (
    <div className="page-head">
      <div><div className="eyebrow">{site.name}</div><h1>{title}</h1></div>
      <p className="small muted legal-date">Mise à jour le {UPDATED}</p>
    </div>
  );
}

/* ---------- Mentions légales ---------- */

export function LegalNoticePage() {
  const site = useSite();
  useTitle("Mentions légales");
  return (
    <article className="legal stack">
      <Head title="Mentions légales" />
      <p className="legal-lead">
        {site.other
          ? <><Sites /> forment un seul site, à deux adresses : même serveur, même code et mêmes comptes. C'est un projet de fan gratuit, sans publicité, fait par un joueur sur son temps libre.</>
          : <><Sites /> est un projet de fan gratuit, sans publicité, fait par un joueur sur son temps libre.</>}
      </p>

      <Sec id="editeur" title="Éditeur">
        <dl className="legal-dl">
          <dt>Éditeur</dt><dd>Sleyvazh (pseudonyme), particulier, à titre non professionnel</dd>
          <dt>Directeur de la publication</dt><dd>Sleyvazh</dd>
          <dt>Contact</dt><dd><Contact /></dd>
        </dl>
        <p>
          L'éditeur publie le site à titre personnel et non professionnel. Comme le permet l'article 1-1, II de la loi n° 2004-575
          du 21 juin 2004 pour la confiance dans l'économie numérique (LCEN), il garde l'anonymat vis-à-vis du public : les
          éléments qui l'identifient (nom, prénom, adresse) ont été communiqués à l'hébergeur ci-dessous.
        </p>
      </Sec>

      <Sec id="hebergeur" title="Hébergeur">
        <dl className="legal-dl">
          <dt>Société</dt><dd>OVH SAS (OVHcloud), SAS au capital de 50 000 000 €</dd>
          <dt>Immatriculation</dt><dd>RCS Lille Métropole 424 761 419 00045</dd>
          <dt>Siège social</dt><dd>2 rue Kellermann, 59100 Roubaix, France</dd>
          <dt>Téléphone</dt><dd>1007 (depuis la France)</dd>
          <dt>Site</dt><dd><ExternalLink href="https://www.ovhcloud.com/fr/">ovhcloud.com</ExternalLink></dd>
        </dl>
        <p>
          Le site tourne sur un serveur privé virtuel (VPS) d'OVHcloud, dans un datacenter situé en France. Les e-mails du site
          (confirmation d'adresse, mot de passe oublié) partent par le serveur de messagerie d'OVHcloud.
        </p>
      </Sec>

      <Sec id="propriete" title="Propriété intellectuelle">
        <ul className="legal-list">
          <li>
            World of Warcraft, WoW, Battle.net et Blizzard Entertainment sont des marques de Blizzard Entertainment, Inc.
            {" "}{site.other
              ? `${names(site)} sont des projets de fan, sans lien avec Blizzard Entertainment, qui ne les a ni approuvés ni soutenus.`
              : `${names(site)} est un projet de fan, sans lien avec Blizzard Entertainment, qui ne l'a ni approuvé ni soutenu.`}
          </li>
          <li>
            Les noms, textes et images du jeu (objets, sorts, talents, icônes des métiers, des rôles, des objets et des classes
            propres à WoW Retail) appartiennent à Blizzard Entertainment. Ils sont affichés pour décrire le jeu.
          </li>
          <li>
            Les icônes des classes et des spécialisations ont été réalisées par <b>Pahpool</b> pour le site. Elles restent son
            œuvre : ne les reprends pas sans son accord.
          </li>
          <li>Discord est une marque de Discord Inc.</li>
          <li>
            Le code du site, de l'addon, du bot Discord et de Roster Companion est publié sous licence MIT
            sur <ExternalLink href="https://github.com/Sleyvazh/forever-roster">GitHub (Sleyvazh/forever-roster)</ExternalLink>.
          </li>
          <li>
            Ce que publient les joueurs (pseudos, noms de groupes, notes, images) reste à leurs auteurs, qui en sont responsables.
          </li>
        </ul>
      </Sec>

      <Sec id="signaler" title="Signaler un contenu">
        <p>
          Un pseudo, un nom de groupe, un texte ou une image publié sur le site te semble illicite ? Écris à <Contact /> en
          donnant ton nom ou ton pseudo, l'adresse exacte de la page, le contenu en cause et la raison pour laquelle il te semble
          illicite. Un contenu manifestement illicite est retiré au plus vite.
        </p>
        <p className="hint">Pour un bug, une idée ou une question sur le site, utilise plutôt « Signaler un bug ou une idée », dans le menu de ton compte.</p>
      </Sec>

      <Sec id="donnees" title="Données personnelles">
        <p>
          Ce que le site garde sur toi, pourquoi, combien de temps, et comment exercer tes droits : voir
          la <Link to="/confidentialite">politique de confidentialité</Link>.
        </p>
      </Sec>
    </article>
  );
}

/* ---------- Politique de confidentialité ---------- */

type Basis = "Contrat" | "Intérêt légitime";
interface Row { title: string; data: ReactNode; why: ReactNode; basis: Basis; keep: ReactNode; who: ReactNode }

const ROWS: Row[] = [
  {
    title: "Ton compte",
    data: "Adresse e-mail, pseudo, mot de passe (haché : personne ne peut le relire), date de création, image du compte, langue des noms du jeu, dernière version de l'addon utilisée.",
    why: "Te connecter, t'envoyer les e-mails du compte, te montrer dans tes groupes.",
    basis: "Contrat",
    keep: "Tant que le compte existe.",
    who: "Toi. Ton pseudo et ton image : les membres de tes groupes. Ton adresse e-mail n'est jamais montrée aux autres joueurs.",
  },
  {
    title: "Battle.net et Discord",
    data: "Si tu les lies : identifiant et BattleTag Battle.net ; identifiant et pseudo Discord ; ton choix pour les messages privés du bot (rappels, relances, demandes des officiers).",
    why: "Te connecter avec Battle.net ; t'inscrire et te prévenir depuis le bot Discord.",
    basis: "Contrat",
    keep: "Jusqu'à ce que tu les délies (Compte & sécurité), ou que le compte soit supprimé.",
    who: "Toi. Ton BattleTag est aussi transmis aux membres de tes groupes.",
  },
  {
    title: "Tes persos",
    data: "Nom, royaume, race, classe, spés, niveau, talents, équipement et objectifs, métiers et patrons, consommables comptés par l'addon, notes, portrait. Ce qu'envoient l'addon et Roster Companion : ces informations, tes inscriptions faites en jeu et la version de l'addon. Sur Roster : identifiant Battle.net du perso, niveau d'objet et spé active lus chez Blizzard.",
    why: "Tenir ta fiche à jour et préparer les raids.",
    basis: "Contrat",
    keep: "Tant que le perso existe (tu peux le supprimer), et au plus tant que le compte existe.",
    who: "Toi, et les membres des groupes que tu partages avec eux : fiche complète, notes comprises.",
  },
  {
    title: "Groupes",
    data: "Nom du groupe, membres et rôles (chef, officier, membre), invitations, salons Discord liés, réglages, journal du groupe (qui a créé un raid, changé un rôle…).",
    why: "Organiser la guilde.",
    basis: "Contrat",
    keep: "Jusqu'à ce que tu quittes le groupe ou que le chef le supprime. Le journal d'un groupe supprimé n'est plus affiché mais reste en base.",
    who: "Les membres du groupe ; le journal : le chef et les officiers.",
  },
  {
    title: "Raids et inscriptions",
    data: "Inscriptions (statut, perso, spé, note), compo, réservations (soft reserve), conseil du butin, demandes des officiers (« Demander à… »), raids récurrents.",
    why: "Organiser les raids, sur le site et sur Discord.",
    basis: "Contrat",
    keep: "Rien n'est effacé automatiquement : tant que le raid existe, jusqu'à ce qu'un officier le supprime ou que le groupe soit supprimé.",
    who: "Les membres du groupe. Les annonces du bot montrent les pseudos, persos et spés des inscrits dans le salon Discord du groupe.",
  },
  {
    title: "Inscrits depuis Discord, sans compte",
    data: "Identifiant et pseudo Discord, classe, spé et statut choisis dans le bot, pour un raid ou une sortie.",
    why: "Compter les joueurs qui s'inscrivent depuis Discord sans compte sur le site.",
    basis: "Intérêt légitime",
    keep: "Jusqu'à ta désinscription (bouton du bot), ou la suppression du raid ou du groupe. Sorties : effacées automatiquement, comme la sortie.",
    who: "Les membres du groupe et le salon Discord de l'annonce.",
  },
  {
    title: "Absences",
    data: "Dates ou jours de la semaine, motif facultatif.",
    why: "Te marquer « Absent » aux raids de ces jours.",
    basis: "Contrat",
    keep: "Jusqu'à ce que tu la retires. Une absence passée n'est plus affichée mais reste en base tant que le compte existe.",
    who: "Tes groupes voient « Absent ». Le motif : toi et les officiers, ou tout le groupe si tu le choisis.",
  },
  {
    title: "Bilans de raid : présence et butin",
    data: "Prénoms en jeu des joueurs du raid, y compris ceux qui n'ont pas de compte sur le site ; heures de présence ; objets reçus et comment (conseil, votes, jet) ; quantités de consommables lors d'un appel ; perso qui a fait le relevé ; corrections du compte des objets par les officiers.",
    why: "Suivre la présence et le compte des objets reçus, pour un butin équitable.",
    basis: "Intérêt légitime",
    keep: "Tant que le raid existe : rien n'est effacé automatiquement.",
    who: "Les membres du groupe.",
  },
  {
    title: "Commandes d'artisanat",
    data: "Demandeur, artisan, recette, quantité, note, perso qui recevra l'objet.",
    why: "Mettre en relation le demandeur et les artisans du groupe.",
    basis: "Contrat",
    keep: "Jusqu'à son annulation (demandeur ou officier). Une commande faite n'est plus affichée après 14 jours mais reste en base tant que le groupe existe.",
    who: "Les membres du groupe et le salon Discord des commandes, s'il est lié.",
  },
  {
    title: "Sorties donjon",
    data: "Créateur et prénom de son perso, inscrits (perso, rôle, liste d'attente), messages privés du bot à envoyer.",
    why: "Former un groupe de 5 pour aujourd'hui ou demain.",
    basis: "Contrat",
    keep: "Effacées automatiquement 2 heures après l'heure prévue (ou à la fin du jour), avec leur message Discord. Messages privés : effacés 7 jours après leur envoi.",
    who: "Les membres du groupe et le salon Discord de la sortie.",
  },
  {
    title: "Signalements",
    data: "Type, titre, texte, page concernée, navigateur et système (lus dans ton navigateur), version de l'addon, capture d'écran facultative (réduite, métadonnées supprimées), ton pseudo, la réponse.",
    why: "Corriger les bugs et te répondre.",
    basis: "Intérêt légitime",
    keep: "Jusqu'à ce qu'un admin du site le supprime. Si tu supprimes ton compte, il reste pour les admins, sans ton pseudo ni ton navigateur, sur le site comme dans le salon Discord.",
    who: "Toi et les admins du site. Ils sont aussi publiés dans le salon Discord privé des admins.",
  },
  {
    title: "Avis Discord (/feedback)",
    data: "Texte de l'avis, signé ou anonyme ; identifiant Discord de l'auteur ; pseudo pour un avis signé ; réponses échangées.",
    why: "Transmettre les réponses de l'équipe à l'auteur et suivre l'avis.",
    basis: "Intérêt légitime",
    keep: "Avis non suivis sur le site : seul le lien entre l'avis et son auteur est gardé, 30 jours (le texte reste dans Discord). Avis suivis par un groupe : texte et réponses gardés jusqu'à ce qu'un officier les supprime ; l'identifiant de l'auteur est effacé 30 jours après la clôture de l'avis.",
    who: "L'équipe du serveur Discord ; le chef et les officiers du groupe qui suit les avis. Un avis anonyme ne montre jamais son auteur : seul le bot connaît son identifiant, pour lui transmettre les réponses.",
  },
  {
    title: "Sécurité : journal et sessions",
    data: "Événements du compte (connexions, échecs, changements sensibles) avec la date, l'adresse IP, le navigateur et le système ; sessions ouvertes (adresse IP, navigateur, dernière activité) ; échecs de connexion avec une adresse inconnue (adresse IP et navigateur, sans l'adresse saisie).",
    why: "Protéger les comptes et te montrer qui s'est connecté.",
    basis: "Intérêt légitime",
    keep: "Journal : effacé au bout de 12 mois ; une action faite dans un groupe reste dans le journal du groupe, sans adresse IP ni navigateur. Sessions : effacées 30 jours après leur fin (déconnexion, expiration ou 7 jours sans activité). Si tu supprimes ton compte, l'adresse IP et le navigateur sont effacés tout de suite de ton journal ; ses événements restent, détachés du compte.",
    who: "Toi (Compte & sécurité). Jamais les autres joueurs.",
  },
  {
    title: "Roster Companion",
    data: "Nom de l'ordinateur, système, version de l'appli, dernière adresse IP, dates de synchro, jeton de l'appareil (haché), persos du jeu que tu as choisi d'ignorer. Demandes d'appairage : les mêmes informations et l'adresse IP.",
    why: "Synchroniser le jeu et le site sans copier-coller.",
    basis: "Contrat",
    keep: "Appareils : tant que le compte existe ; un appareil délié est effacé 30 jours après, avec sa dernière adresse IP. Demandes d'appairage : effacées un jour après leur expiration, à la demande suivante.",
    who: "Toi.",
  },
  {
    title: "Import Battle.net (Roster)",
    data: "Liste des persos de ton compte Battle.net : nom, royaume, classe, niveau, faction.",
    why: "Choisir les persos à importer.",
    basis: "Contrat",
    keep: "Utilisable 30 minutes, puis effacée dans l'heure. Le jeton donné par Blizzard n'est jamais gardé.",
    who: "Toi.",
  },
  {
    title: "E-mails du compte",
    data: "Ton adresse et les liens envoyés (confirmation d'adresse : 24 heures ; nouveau mot de passe : 30 minutes), gardés hachés.",
    why: "Confirmer ton adresse, réinitialiser ton mot de passe, te prévenir d'une tentative d'inscription avec ton adresse.",
    basis: "Contrat",
    keep: "Le site ne garde pas le contenu des e-mails. Les liens, hachés, sont effacés 30 jours après leur utilisation ou leur expiration.",
    who: "OVHcloud, qui achemine les e-mails.",
  },
  {
    title: "Journaux techniques du serveur",
    data: "Pour chaque requête : adresse IP, page appelée, code de réponse, heure.",
    why: "Diagnostiquer les pannes et repérer les attaques.",
    basis: "Intérêt légitime",
    keep: "Jusqu'à la mise à jour suivante du site, en pratique quelques jours, et au plus 30 Mo par service : au-delà, les plus anciens sont effacés.",
    who: "L'éditeur seulement.",
  },
];

function DataTable() {
  return (
    <div className="legal-tw">
      <table className="legal-t">
        <caption className="sr-only">Données gardées par le site : contenu, finalité et base légale, durée, destinataires</caption>
        <thead><tr><th scope="col">Données</th><th scope="col">Pourquoi</th><th scope="col">Combien de temps</th><th scope="col">Qui les voit</th></tr></thead>
        <tbody>{ROWS.map(r => (
          <tr key={r.title}>
            <th scope="row" data-l="Données"><b>{r.title}</b><span>{r.data}</span></th>
            <td data-l="Pourquoi">{r.why}<span className={`tag legal-basis${r.basis === "Contrat" ? "" : " li"}`}>{r.basis}</span></td>
            <td data-l="Combien de temps">{r.keep}</td>
            <td data-l="Qui les voit">{r.who}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

const COOKIES: [string, string, string][] = [
  ["__Host-fr_sid", "Ta session de connexion (jeton aléatoire, illisible par les scripts de la page).", "30 jours au plus ; fermée plus tôt à la déconnexion ou après 7 jours sans activité."],
  ["fr_oauth", "Protège la connexion avec Battle.net contre les attaques (lien entre ton navigateur et la demande en cours).", "10 minutes, seulement pendant la connexion."],
  ["fr_discord", "Protège de la même façon la liaison de ton compte Discord.", "10 minutes, seulement pendant la liaison."],
];
const STORAGE: [string, string][] = [
  ["fr-theme", "Thème choisi (clair ou sombre) ; absent : celui de ton appareil."],
  ["fr-news-seen", "Dernière nouveauté lue (point doré du bouton « Nouveautés »)."],
  ["fr-steps-hidden", "Étapes de démarrage masquées."],
  ["fr-view-…", "Affichages choisis : liste des persos du groupe, arbres de talents, bandeau « Cette semaine »."],
  ["fr-addon-fiches", "Ancien choix des fiches à l'import de l'addon : seulement relu, plus jamais écrit."],
  ["fr-invite", "Lien d'invitation à un groupe, le temps de te connecter ; effacé ensuite (session de l'onglet)."],
  ["fr-tab", "Dernier onglet ouvert d'une fiche de perso (session de l'onglet)."],
];

export function PrivacyPage() {
  const site = useSite();
  useTitle("Confidentialité");
  return (
    <article className="legal stack">
      <Head title="Politique de confidentialité" />
      <div className="legal-lead stack">
        <p>
          Cette page dit quelles données le site garde sur toi, pourquoi, combien de temps et qui les voit. Elle vaut
          pour {site.other ? <>les deux adresses du site, <Sites />, qui partagent le même serveur, la même base et les mêmes comptes,</> : <><Sites />,</>} et
          pour le bot Discord, l'addon et Roster Companion quand ils échangent avec le site.
        </p>
        <ul className="legal-list">
          <li>Le site sert à organiser tes persos et tes raids. Il ne vend rien, n'affiche aucune publicité et ne mesure pas l'audience.</li>
          <li>Tes données sont gardées sur un serveur en France, chez OVHcloud.</li>
          <li>Tu peux supprimer ton compte à tout moment, dans <Link to="/account">Compte &amp; sécurité</Link>.</li>
        </ul>
      </div>

      <nav className="panel pad legal-toc" aria-label="Sommaire">
        <ol>
          <li><a href="#responsable">Responsable</a></li>
          <li><a href="#donnees">Données, durées et destinataires</a></li>
          <li><a href="#bases">Bases légales</a></li>
          <li><a href="#partage">Avec qui elles sont partagées</a></li>
          <li><a href="#cookies">Cookies et stockage local</a></li>
          <li><a href="#securite">Sécurité</a></li>
          <li><a href="#droits">Tes droits</a></li>
          <li><a href="#sans-compte">Joueurs sans compte</a></li>
        </ol>
      </nav>

      <Sec id="responsable" title="Responsable du traitement">
        <p>
          Le responsable est l'éditeur du site : <b>Sleyvazh</b>, particulier, à titre non professionnel
          (voir les <Link to="/mentions-legales">mentions légales</Link>). Pour toute question sur tes données : <Contact />.
          Le site n'a pas de délégué à la protection des données : il n'y est pas obligé.
        </p>
      </Sec>

      <Sec id="donnees" title="Données, durées et destinataires">
        <p>Voici tout ce que le site garde, tel que son code le fait aujourd'hui.</p>
        <DataTable />
        <h3>Quand tu supprimes ton compte</h3>
        <p>
          Sont effacés tout de suite : ton compte, tes persos, tes inscriptions, tes absences, tes images, tes sessions, tes
          appareils, tes commandes d'artisanat et tes liaisons Battle.net et Discord. Si tu es chef d'un groupe, transfère-le ou
          supprime-le d'abord.
        </p>
        <p>
          Restent, sans lien avec ton compte : tes signalements, sans ton pseudo ni ton navigateur ; ton nom recopié sur certaines
          actions faites dans un groupe (corrections du compte des objets, demandes « Demander à… ») ; les prénoms de tes persos dans
          les bilans de raid ; les événements de ton journal de sécurité, sans adresse IP ni navigateur, jusqu'à leur effacement au
          bout de 12 mois (ceux du journal d'un groupe restent avec lui). Tu peux demander leur effacement (voir « Tes droits »).
        </p>
        <h3>Sauvegardes</h3>
        <p>
          La base est sauvegardée chaque nuit ; chaque sauvegarde est gardée 14 jours sur le serveur. Une donnée effacée sur le site
          disparaît donc des sauvegardes du serveur au plus tard 14 jours après. Une copie est aussi rapatriée chaque semaine chez
          l'éditeur, hors du serveur, pour pouvoir reconstruire le site après une panne ; elle ne sert qu'à cela et n'a pas encore
          de durée maximale.
        </p>
      </Sec>

      <Sec id="bases" title="Bases légales">
        <ul className="legal-list">
          <li>
            <span className="tag legal-basis">Contrat</span> : le service que tu demandes en créant un compte ou en utilisant le bot
            (compte, persos, groupes, raids, absences, commandes, sorties, Roster Companion, e-mails du compte).
          </li>
          <li>
            <span className="tag legal-basis li">Intérêt légitime</span> : la sécurité du site (journal, sessions, journaux du
            serveur), l'organisation des groupes (bilans de raid, inscrits Discord sans compte) et l'amélioration du site
            (signalements, avis). Tu peux t'y opposer (voir « Tes droits »).
          </li>
          <li>
            Le site ne te demande pas ton consentement, car il ne fait rien qui en ait besoin : pas de publicité, pas de mesure
            d'audience, pas de revente de données.
          </li>
        </ul>
      </Sec>

      <Sec id="partage" title="Avec qui elles sont partagées">
        <ul className="legal-list">
          <li><b>Les autres joueurs</b>, seulement comme le dit le tableau (colonne « Qui les voit »).</li>
          <li>
            <b>OVHcloud</b> (OVH SAS, Roubaix) : héberge le serveur, dans un datacenter en France, et achemine les e-mails du site.
          </li>
          <li>
            <b>Discord</b> (Discord Inc., États-Unis), seulement si tu lies ton compte Discord ou utilises le bot. Discord reçoit ce
            que le bot publie : annonces (pseudos, persos et spés des inscrits), messages privés, avis, et les signalements dans le
            salon privé des admins. Le site reçoit de Discord ton identifiant et ton pseudo, rien d'autre (ni ton e-mail, ni tes
            serveurs). Ces données sont traitées par Discord, y compris aux États-Unis, selon sa propre politique de confidentialité.
          </li>
          <li>
            <b>Blizzard Entertainment</b>, pour la connexion avec Battle.net : le site reçoit ton identifiant Battle.net et ton
            BattleTag. Sur Roster, pour l'import (liste des persos de ton compte) et le bouton « Mettre à jour » (profil public du
            perso : niveau, niveau d'objet, spé active). Le jeton donné par Blizzard n'est jamais gardé.
          </li>
          <li>
            <b>Have I Been Pwned</b> : quand tu choisis un mot de passe, le site vérifie qu'il n'apparaît pas dans une fuite connue.
            Seuls les 5 premiers caractères de son empreinte (SHA-1), communs à des centaines de mots de passe, sont envoyés : ni ton
            mot de passe, ni ton adresse, ni ton adresse IP (la demande part du serveur).
          </li>
          <li>
            <b>Ton addon</b> : « Copier pour le jeu » et Roster Companion mettent les données de tes groupes dans l'addon, sur ton
            ordinateur. L'addon peut les transmettre en jeu aux joueurs de ta guilde et de ton raid qui l'ont aussi ; chacun ne garde
            que les groupes dont il fait partie. Tu peux couper ce partage dans les options de l'addon.
          </li>
          <li><b>GitHub</b> : Roster Companion y cherche ses mises à jour, sans y envoyer de données du site.</li>
        </ul>
        <p>
          Aucune donnée n'est vendue ni cédée. Le site ne charge rien depuis un autre site (ni police, ni image, ni script) : aucun
          outil de mesure d'audience, aucune publicité, aucun bouton de réseau social.
        </p>
      </Sec>

      <Sec id="cookies" title="Cookies et stockage local">
        <p>
          Le site pose seulement des cookies nécessaires à son fonctionnement et garde quelques choix d'affichage dans ton
          navigateur. Ils sont dispensés de consentement (article 82 de la loi Informatique et Libertés) : c'est pourquoi le site
          n'affiche pas de bandeau cookies.
        </p>
        <h3>Cookies posés par le site</h3>
        <div className="legal-tw">
          <table className="legal-t small-t">
            <caption className="sr-only">Cookies posés par le site</caption>
            <thead><tr><th scope="col">Nom</th><th scope="col">À quoi il sert</th><th scope="col">Durée</th></tr></thead>
            <tbody>{COOKIES.map(([n, why, d]) => (
              <tr key={n}><th scope="row" data-l="Nom"><code>{n}</code></th><td data-l="À quoi il sert">{why}</td><td data-l="Durée">{d}</td></tr>
            ))}</tbody>
          </table>
        </div>
        <h3>Stockage local du navigateur</h3>
        <p>Ces valeurs restent dans ton navigateur : elles ne sont jamais envoyées au serveur.</p>
        <div className="legal-tw">
          <table className="legal-t small-t">
            <caption className="sr-only">Stockage local du navigateur</caption>
            <thead><tr><th scope="col">Nom</th><th scope="col">À quoi il sert</th></tr></thead>
            <tbody>{STORAGE.map(([n, why]) => (
              <tr key={n}><th scope="row" data-l="Nom"><code>{n}</code></th><td data-l="À quoi il sert">{why}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </Sec>

      <Sec id="securite" title="Sécurité">
        <p>
          Le site n'est servi qu'en HTTPS. Les mots de passe sont hachés avec Argon2id et les jetons de connexion sont gardés hachés :
          même une fuite de la base ne les révélerait pas. Chaque action est vérifiée par le serveur : un joueur ne voit que les
          groupes dont il est membre. Le serveur est tenu à jour, son accès est restreint, et la base est sauvegardée chaque nuit.
          Le code est public : chacun peut le relire. Si une fuite de données présentait un risque pour toi, tu en serais prévenu,
          comme le prévoit le RGPD.
        </p>
      </Sec>

      <Sec id="droits" title="Tes droits">
        <ul className="legal-list">
          <li><b>Accès</b> : <Link to="/account">Compte &amp; sécurité</Link> montre ton compte, tes sessions, tes appareils et ton journal de sécurité ; tes persos et tes groupes sont sur le site. Pour une copie complète, écris à <Contact />.</li>
          <li><b>Rectification</b> : modifie directement ton pseudo, tes persos ou tes absences, ou écris à l'éditeur.</li>
          <li><b>Effacement</b> : « Supprimer mon compte », dans Compte &amp; sécurité, efface ton compte tout de suite. Tu peux aussi supprimer un perso, une absence ou une inscription, et délier Battle.net, Discord ou un appareil. Pour le reste (signalements, journal, bilans de raid), écris à l'éditeur.</li>
          <li><b>Portabilité</b> : sur demande, une copie de tes données dans un fichier lisible (JSON).</li>
          <li><b>Opposition et limitation</b> : pour ce qui repose sur l'intérêt légitime, sur demande. Les messages privés du bot se coupent dans Compte &amp; sécurité.</li>
        </ul>
        <p>
          Pour exercer ces droits, écris à <Contact />, si possible depuis l'adresse de ton compte : l'éditeur peut te demander de
          prouver que le compte est le tien. Réponse sous un mois au plus.
        </p>
        <p>
          Sans réponse, ou si elle ne te convient pas, tu peux adresser une réclamation à la CNIL : Service des plaintes, 3 place de
          Fontenoy, 75007 Paris, ou en ligne sur <ExternalLink href="https://www.cnil.fr/fr/plaintes">cnil.fr/fr/plaintes</ExternalLink>.
        </p>
      </Sec>

      <Sec id="sans-compte" title="Joueurs sans compte">
        <p>Le site garde aussi un peu de données sur des joueurs qui n'y ont pas de compte :</p>
        <ul className="legal-list">
          <li>
            <b>Inscrits depuis Discord</b> : ton identifiant et ton pseudo Discord, la classe, la spé et le statut choisis, pour le
            raid ou la sortie concernés. Te désinscrire avec le bouton du bot efface l'inscription.
          </li>
          <li>
            <b>Bilans de raid</b> : l'addon d'un officier note les prénoms en jeu des joueurs présents dans le raid, leurs heures de
            présence, les objets reçus et les consommables. Ces bilans restent dans le groupe tant que le raid existe.
          </li>
          <li>
            <b>Avis Discord</b> : ton identifiant Discord, pour te transmettre les réponses, effacé comme le dit le tableau.
          </li>
        </ul>
        <p>
          Pour les faire effacer, demande aux officiers du groupe, ou écris à <Contact /> en donnant ton prénom en jeu ou ton pseudo
          Discord, et le groupe ou le serveur Discord concerné. Tu as les mêmes droits qu'un joueur avec un compte.
        </p>
      </Sec>

      <p className="hint">
        Cette page suit le site : elle change quand il change, et la date en haut montre sa dernière mise à jour. Un changement
        important est annoncé dans les Nouveautés. Voir aussi les <Link to="/mentions-legales">mentions légales</Link> de {site.name}.
      </p>
    </article>
  );
}
