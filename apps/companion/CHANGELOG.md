# Roster Companion : versions

La section « ## <version> » de la version publiée devient le texte de la GitHub Release et des « notes » de la mise à jour que l'appli affiche (scripts/companion-release.mjs la lit sur un tag `companion-v<version>`). En français : l'appli n'est pas traduite.

## 0.3.1

- Relevé de la guilde : avec l'addon Forever Roster 1.6.2, l'appli envoie aussi au site le relevé de ta guilde (liste des membres, journal, banque, niveaux de tes persos), seulement quand il a changé, comme les persos et les bilans. Un relevé trop gros pour le site (guilde immense) n'est pas envoyé : la raison s'affiche dans « Vers le site ».

## 0.3.0

- Mises à jour automatiques signées : l'appli vérifie au démarrage puis une fois par jour si une version plus récente est publiée sur GitHub, l'annonce (bandeau, notification si activées) et l'installe sur un clic, jamais pendant que le jeu tourne. L'installateur est vérifié avec la clé publique de signature avant d'être lancé ; rien n'est envoyé.
- Corrections de fiabilité : renvoi sans fin, clics perdus, erreurs trompeuses.

## 0.2.2

- Inscriptions faites en jeu fiables : chaque clic part au site (l'heure du clic compte dans l'empreinte du perso), une inscription est oubliée dès que le site l'a enregistrée, et un ancien choix n'écrase plus un changement fait ensuite sur le site. Avec l'addon 1.5.4 : « Envoyer maintenant » dans l'onglet Raids.

## 0.2.1

- Les 20 copies de `ForeverRoster_Data` sont rangées sous l'en-tête repliable « Roster Companion » de la liste des addons du jeu (« Copie 01 » à « Copie 20 ») ; les `.toc` sont réécrits à la mise à jour de l'appli.

## 0.2.0

- Synchro plus fluide avec l'addon 1.5 : 20 copies des données chargées à la demande (sans `/reload`), notification « nouveautés prêtes pour le jeu » quand le site change pendant que le jeu tourne (en option), relevé toutes les minutes pendant que le jeu tourne.
- Build Windows réparé (Tauri 2.12).

## 0.1.0

- Première bêta Windows : appairage par code validé sur le site (jeton dans le Gestionnaire d'identification), dossiers du jeu trouvés tout seuls ou choisis à la main, envoi des persos et bilans dès que le jeu écrit la sauvegarde de l'addon, persos inconnus (« Créer la fiche » ou « Ignorer »), relevé du site toutes les 5 minutes (1, 5 ou 15) écrit dans `ForeverRoster_Data`, icône près de l'horloge, notifications en option.
