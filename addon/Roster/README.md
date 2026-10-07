# Addon Roster

Addon pour WoW Retail (Midnight, interfaces 120100 et 120105), lié au site Roster (roster.sleyvazh.fr). Comme Forever Roster, il n'a pas accès à internet : les données passent par copier-coller (formats `RRG`, `RRR` et `RRB`, `docs/addon-format.md`, section « Roster : l'addon pour WoW Retail »). Dossier `Roster`, sauvegarde `RosterDB`, commande `/roster`. Il partage avec Forever Roster la boîte à outils `addon/shared` (fenêtres, listes, habillages, police des titres), copiée dans le zip à la construction du site.

**Synchro rapide** : ta touche (onglet **Options**, ou Échap > Options > Raccourcis > AddOns > Roster), le clic droit sur le bouton de la minicarte ou sur Roster dans la liste des addons de la minicarte ouvrent une petite fenêtre avec une seule case. Ce qui part au site (bilans de raid) y est déjà sélectionné : Ctrl+C, la fenêtre se ferme, puis Ctrl+V sur n'importe quelle page du site. Ou Ctrl+V dans la case pour coller ce que tu as copié sur le site : chargé, puis fermeture.

La fenêtre complète, ouverte par le bouton de la minicarte ou `/roster`, a cinq onglets :

| Onglet | Rôle |
|---|---|
| **Synchro** | En haut : colle « Copier pour le jeu » (données des groupes) ou « Export pour le jeu » (compo d'un raid), chargé dès que le texte est complet (message vert, ou rouge s'il est refusé). En bas : le bilan des raids déjà sélectionné ; Ctrl+C le marque envoyé, « Tout renvoyer » pour tout recopier |
| **Raids** | Raids à venir de tes groupes |
| **En raid** | Pendant le raid : qui a l'addon (et sa version), relevé de la présence et du butin |
| **Compo** | La compo collée : **Inviter**, **Placer les groupes** |
| **Options** | Touches (choisir, retirer), habillage (jeu ou site), bouton de la minicarte, relevé de la présence et du butin, seuil de qualité du butin |

| Commande | Rôle |
|---|---|
| Raccourcis (AddOns > Roster) | « Synchro rapide avec le site (copier / coller) » et « Ouvrir ou fermer la fenêtre » (`Bindings.xml`) |
| `/roster` | Ouvrir ou fermer la fenêtre |
| `/roster synchro`, `raids`, `enraid`, `compo`, `options` | Ouvrir un onglet |
| `/roster inviter` | Inviter les persos de la compo chargée |
| `/roster placer` | Placer les persos dans leurs groupes (chef du raid ou assistant, hors combat) |
| `/roster versions` | Qui a l'addon dans le raid, et sa version |
| `/roster minicarte` | Afficher ou masquer le bouton de la minicarte (clic : fenêtre, clic droit : synchro rapide, glisser : déplacer ; pastille : envois en attente ; « REC » : relevé en cours). Roster reste dans la liste des addons de la minicarte |
| `/roster habillage` | Passer de l'habillage du jeu à celui du site, et inversement (recharge l'interface ; aussi dans Options) |

Relevé du raid : pendant un raid du site chargé en jeu (heure prévue passée depuis moins de 3 h, ou dans moins de 2 h), l'addon note chaque minute qui est dans le groupe de raid, le butin à partir d'une qualité réglable (épique par défaut) et chaque fin de rencontre. « REC » s'affiche sur le bouton de la minicarte. Le bilan (bloc `RRB`) part avec la synchro ; le site ne retient que celui d'un officier du groupe ou du créateur du raid. Le relevé se coupe dans Options (`RosterDB.record = false`, seuil dans `RosterDB.lootQuality` : 3 rare, 4 épique, 5 légendaire).

Habillage : celui du jeu par défaut (cadres de l'interface de WoW, onglets à icône sur le côté), ou celui du site (fond sombre, liserés argent-azur, titres en Marcellus SC, onglets en haut). La police est dans `Fonts/` (licence SIL OFL, `Fonts/OFL.txt`), le logo dans `Media/Logo.tga` : le W au trait et l'épée du logo du site, argent-azur sur un disque bleu nuit (dessin original, TGA 32 bits 128 × 128). Le changement s'applique au rechargement de l'interface.

## Installation

Télécharger le zip sur la page **Addon** de Roster, puis copier le dossier `Roster` dans `World of Warcraft\_retail_\Interface\AddOns\`, puis relancer le jeu ou taper `/reload`.

## Tests hors jeu

```bash
for f in addon/Roster/*.lua addon/shared/*.lua; do luac5.1 -p "$f"; done
lua5.1 addon/tests/roster_format_test.lua   # formats RRG, RRR, RRB et noms « Prénom-Royaume » (écrit sample.rrb, relit sample.rrg et sample.rrr du site)
lua5.1 addon/tests/roster_sim.lua           # jeu simulé : compo, invitations, placement, versions, file des messages, relevé et bilan
lua5.1 addon/tests/roster_ui_test.lua       # fenêtre, commandes, synchro rapide, options, minicarte
```

Les simulations chargent les fichiers du `.toc` dans l'ordre (dossier de l'addon, puis `addon/shared`) ; les variables de Blizzard ne doivent jamais être réassignées, et aucune valeur secrète du jeu (12.x) ne doit finir dans la sauvegarde.

**À vérifier en jeu (0.1.0)** : invitations `Prénom-Royaume` (même royaume et autres royaumes), passage en raid pendant que des invitations sont en attente, placement des groupes, réponses des versions et file d'attente pendant un boss (`SendAddonMessage` renvoie `AddOnMessageLockdown`), textes du butin en français dans le chat (butin de groupe et butin personnel), noms avec ou sans royaume dans les messages des addons.
