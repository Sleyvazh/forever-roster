/**
 * Nouveautés du site et de l'addon (bouton « Nouveautés » de la barre du haut), écrites pour les joueurs.
 * Ajouter les nouvelles en tête, avec un numéro `n` plus grand que le précédent (sert à savoir ce qui est déjà lu).
 */
export interface NewsItem { n: number; date: string; kind: "site" | "addon" | "bot"; version?: string; title: string; text: string }

export const NEWS: NewsItem[] = [
  { n: 14, date: "2026-10-05", kind: "bot", title: "Donne ton avis à ton équipe, signé ou anonyme",
    text: "Sur Discord, /feedback (ou le bouton « Donner mon avis » du salon prévu) : le bot t'écrit en privé, tu écris ton avis, puis tu choisis de l'envoyer signé ou anonyme. L'équipe peut te répondre, même anonyme. Marche aussi sur un serveur qui n'utilise pas le site." },
  { n: 13, date: "2026-10-04", kind: "addon", version: "0.9", title: "L'addon habillé comme le site",
    text: "Dans l'onglet Options, choisis l'habillage « Site » : fond sombre, liserés dorés, titres du site et onglets en haut. « Forever (jeu) » garde l'interface du jeu. Aussi avec /fr habillage." },
  { n: 12, date: "2026-10-04", kind: "addon", version: "0.8.1", title: "Inscriptions en jeu aux couleurs du site",
    text: "Présent en vert, En retard en orange, Peut-être en gris, Absent en rouge : ta réponse actuelle est surlignée, dans l'onglet Raids comme dans « Tu viens ? »." },
  { n: 11, date: "2026-10-04", kind: "addon", version: "0.8", title: "Présence et butin relevés pendant les raids",
    text: "Pendant un raid prévu sur le site, l'addon note qui est là et le butin épique. Après le raid, un officier fait sa synchro : le bilan s'affiche sur la page du raid, le BiS reçu est coché sur la fiche, et l'onglet « Présence & butin » du groupe fait les comptes." },
  { n: 10, date: "2026-10-04", kind: "site", title: "Liste des persos du groupe remise d'aplomb",
    text: "Colonnes alignées, noms longs sur une ligne, persos à configurer en fin de liste, et un affichage propre sur téléphone." },
  { n: 9, date: "2026-10-04", kind: "site", title: "Page Groupes plus parlante",
    text: "Chaque groupe montre son prochain raid et ta réponse, le nombre de raids à venir, le roster par rôle et des raccourcis vers ses onglets." },
  { n: 8, date: "2026-10-03", kind: "addon", version: "0.7", title: "Un onglet Options en jeu",
    text: "Choisis ta touche de synchro en appuyant dessus, masque le bouton de la minicarte, coupe le rappel de raid, retire de l'export un perso supprimé." },
  { n: 7, date: "2026-10-03", kind: "site", title: "Ton prochain raid en haut de Mes persos",
    text: "Inscris-toi en un clic (Présent, Peut-être, Absent). « À faire » déplie les autres raids de la semaine et les fiches à compléter." },
  { n: 6, date: "2026-10-03", kind: "addon", version: "0.6", title: "« Tu viens ? » à la connexion",
    text: "Un raid dans les 24 h sans réponse ? L'addon te le demande quand tu te connectes." },
  { n: 5, date: "2026-10-03", kind: "site", title: "Les onglets gardés dans l'adresse",
    text: "Le retour arrière et le rechargement restent sur l'onglet ouvert, et tu peux envoyer le lien direct d'un onglet (par exemple les Artisans de ton groupe)." },
  { n: 4, date: "2026-10-02", kind: "addon", version: "0.5", title: "Synchro rapide : une touche, une case",
    text: "Ta touche ouvre une petite fenêtre : Ctrl+C pour envoyer tes persos, Ctrl+V pour charger les données du site. Sur le site, Ctrl+V sur n'importe quelle page." },
  { n: 3, date: "2026-10-02", kind: "addon", version: "0.4", title: "L'addon aux couleurs de Forever",
    text: "Fenêtre, onglets et bordures reprennent l'interface du jeu." },
  { n: 2, date: "2026-10-02", kind: "addon", version: "0.2", title: "Patrons et BiS suivis en jeu",
    text: "Infobulles « Recherché par », « Connu par », « BiS de », liste de tes sacs avec Annoncer, et alerte quand tu ramasses un objet suivi." },
  { n: 1, date: "2026-10-02", kind: "site", title: "Les vrais arbres de talents de Forever",
    text: "Les talents de ta fiche suivent les arbres du client Forever, et l'addon les lit directement en jeu." },
];
