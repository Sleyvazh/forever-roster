# Addon Forever Roster

Addon WoW pour le client de WoW Forever (interface 16001). Il fait le lien avec le site par copier-coller (un addon n'a pas accès à internet).

**Synchro rapide** : ta touche (onglet **Options** de l'addon, ou Échap > Options > Raccourcis > AddOns > Forever Roster) ou le clic droit sur le bouton de la minicarte ouvrent une petite fenêtre avec une seule case. Ton export y est déjà sélectionné : Ctrl+C, la fenêtre se ferme, puis Ctrl+V sur n'importe quelle page du site. Ou Ctrl+V dans la case pour coller ce que tu as copié sur le site (« Copier pour le jeu ») : chargé, puis fermeture.

La fenêtre complète, ouverte par le **bouton de la minicarte** ou `/fr`, a six onglets :

| Onglet | Rôle |
|---|---|
| **Synchro** | En haut : colle ce que tu as copié sur le site (données des groupes ou compo d'un raid), chargé tout seul. En bas : ton export déjà sélectionné, seulement les persos qui ont changé ; Ctrl+C le marque envoyé |
| **Raids** | Raids à venir de tes groupes et inscription du perso connecté |
| **En raid** | Qui a l'addon dans le raid (et sa version), appel aux consommables et manques, objets à remettre (échange dans les 2 h), tes tâches sur les fiches de boss, fenêtre du butin |
| **Compo** | La compo collée : état de chaque perso (bon groupe, à déplacer, absent), **Inviter**, **Placer les groupes** |
| **Patrons** | Patrons et BiS suivis dans tes sacs (**Annoncer**), autres patrons à marquer « recherché » |
| **Options** | Touches (choisir, retirer), habillage (Forever ou site), bouton de la minicarte, rappel de raid, relevé présence et butin (et seuil de qualité), persos à retirer de l'export |

| Commande | Rôle |
|---|---|
| Raccourcis (AddOns > Forever Roster) | « Synchro rapide avec le site » et « Ouvrir ou fermer la fenêtre » (`Bindings.xml`) |
| `/fr` | Ouvrir ou fermer la fenêtre |
| `/fr synchro`, `raids`, `enraid`, `compo`, `patrons`, `options` | Ouvrir un onglet |
| `/fr butin` | Fenêtre du maître du butin (s'ouvre seule en ouvrant un corps en butin de maître) ; `/fr butin <lien>` pour un objet déjà dans tes sacs |
| `/fr boss` | Fiche du boss ciblé, sinon la première du raid |
| `/fr conso` | Appel aux consommables (chef de raid ou assistant) |
| `/fr test` | Raid d'essai : toi et 9 joueurs fictifs, pour tout essayer seul (aussi dans l'onglet En raid, hors groupe) |
| `/fr cherche <lien>` | Marquer un patron vu ailleurs comme recherché (Maj+clic pour mettre le lien), ou l'en retirer |
| `/fr oublier Nom-Royaume` | Retirer un perso supprimé de l'export (aussi dans Options) |
| `/fr rappels` | Couper ou remettre le rappel de raid à la connexion (aussi dans Options) |
| `/fr habillage` | Passer de l'habillage Forever (jeu) à celui du site, et inversement (recharge l'interface ; aussi dans Options) |
| `/fr minicarte` | Afficher ou masquer le bouton de la minicarte (clic : fenêtre, clic droit : synchro rapide, glisser : déplacer ; pastille : persos à envoyer ; aussi dans Options) |

Relevé du raid : pendant un raid prévu sur le site (données du site chargées en jeu), l'addon note chaque minute qui est dans le groupe de raid, et le butin de qualité épique ou plus (réglable dans Options). « REC » s'affiche sur le bouton de la minicarte. Le bilan (bloc FRB) part avec la synchro rapide ; le site ne retient que celui d'un officier du groupe.

Rappel de raid : à la connexion, un raid de tes groupes dans les 24 h sans réponse ouvre une petite fenêtre « Tu viens ? » (Présent, En retard, Peut-être, Absent) ; un raid déjà répondu s'affiche dans le chat. Il se base sur les dernières données du site collées en jeu.

Habillage : celui de Forever par défaut (cadres, onglets à icône sur le côté, textures du jeu), ou celui du site (fond sombre, liserés dorés, titres en Marcellus SC, onglets en haut, boutons plats). La police est dans `Fonts/` (licence SIL OFL, `Fonts/OFL.txt`). Le changement s'applique au rechargement de l'interface.

Butin en raid (1.0) : quand tu es maître du butin, ouvrir un corps affiche les objets (épiques par défaut) avec, selon le mode du raid sur le site, **Jets SR** (seuls ceux qui ont réservé lancent `/roll 100`, l'addon ajoute le bonus SR+), **Jets MS / OS** (`/roll 100` puis `/roll 99`), **Jet libre** ou **Conseil** (chacun répond BiS, Upgrade, Off-Spec, Transmo ou Passer ; le conseil vote). Égalité : seuls les ex æquo relancent. **Donner** passe par le butin de maître ; corps fermé, ou **Garder, à remettre** : l'objet va dans les objets à remettre, et **Échanger** ouvre l'échange avec le gagnant et y pose l'objet. Chaque attribution est notée dans le bilan (méthode, réponse, jet).

Fiches de boss (1.0) : remplies sur le site (onglet Préparation du raid). En ciblant le boss avant le pull, chacun voit sa tâche et le reste de la fiche ; le chef de raid peut l'annoncer en /raid. La fiche se ferme au début du combat. Le boss est reconnu par son PNJ ; pour un nouveau raid de Forever, l'addon l'apprend au premier combat.

Consommables (1.0) : les consommables demandés par les raids sont comptés dans tes sacs (et ta banque) et partent avec la synchro. En raid, **Appel aux consommables** : l'addon de chacun répond tout de suite ; **Annoncer les manques** l'écrit dans le raid.

Raid d'essai (1.1) : `/fr test`, hors groupe. Un panneau propose chaque étape avec 9 joueurs fictifs qui répondent comme de vrais addons : versions (une ancienne, un joueur sans addon), appel aux consommables (tes vraies potions comptent), fiche de Ragnaros en ciblant n'importe quel PNJ (fermée en attaquant), corps en soft reserve (bonus SR+, égalité à relancer, personne en MS puis jets OS, jet libre ; ton propre `/roll` compte) et corps au conseil (réponses, dont deux chuchotées, votes de deux membres du conseil, ta réponse et ton vote). « Donner » simule le butin de maître, « Garder, à remettre » puis « Échanger » simulent l'échange. Rien ne part au site, au chat du raid ni aux autres joueurs ; le vrai butin de maître et l'échange restent à vérifier dans un vrai raid.

Infobulles : « Recherché par », « Connu par », « BiS de » sur les objets suivis, et « SR (raid) : … » sur les objets réservés. Butin : alerte avec **Annoncer au groupe** quand tu ramasses un patron suivi ou un BiS recherché.

## Installation

Télécharger le zip sur la page **Addon** du site, puis copier le dossier `ForeverRoster` dans `World of Warcraft\_classic_beta_\Interface\AddOns\` (après la sortie : `_classic_`), puis relancer le jeu ou taper `/reload`.

## Notes

- **Patrons :** le jeu ne donne la liste des patrons connus que lorsqu'une fenêtre de métier est ouverte. Ouvre chacune une fois (avec les filtres retirés) avant `/fr export`.
- **Invitations :** hors raid, un groupe ne dépasse pas 5 personnes. L'addon invite les 4 premiers, passe en raid dès que le groupe est formé, puis invite la suite. Les inscrits Discord sans compte sont listés à part, leur pseudo n'étant pas forcément leur nom en jeu.
- **Relevé automatique :** chaque perso est relevé à la connexion et quand il change (équipement, niveau, talents, métiers, fenêtre de métier). Connecte-toi une fois avec un perso pour qu'il entre dans l'export.
- **Inscriptions et patrons recherchés en jeu :** gardés par perso, ils partent au site avec l'export.
- **Butin :** seule ta propre ramasse déclenche l'alerte ; « Annoncer » écrit dans le raid (ou le groupe), sinon dans ton chat.
- **Placement :** chef du raid ou assistant, hors combat. Un déplacement à la fois, au rythme des mises à jour du raid.
- **À vérifier sur le client de Forever (1.0) :** butin de maître (`GiveMasterLoot`), messages entre addons, délai d'échange de 2 h, début de combat (`ENCOUNTER_START`) et PNJ des boss. Sans ces API, la fonction concernée ne fait rien ; les jets, eux, passent toujours par le chat.

## Tests hors jeu

```bash
for f in addon/ForeverRoster/*.lua; do luac5.1 -p "$f"; done
lua5.1 addon/tests/format_test.lua   # formats d'échange avec le site
lua5.1 addon/tests/wow_sim.lua       # API de WoW simulée : chargement de l'addon et commandes
```
