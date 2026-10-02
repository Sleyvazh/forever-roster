# Addon Forever Roster

Addon WoW pour le client de WoW Forever (interface 16001). Il fait le lien avec le site par copier-coller (un addon n'a pas accès à internet).

**Synchro rapide** : ta touche (Échap > Options > Raccourcis > AddOns > Forever Roster) ou le clic droit sur le bouton de la minicarte ouvrent une petite fenêtre avec une seule case. Ton export y est déjà sélectionné : Ctrl+C, la fenêtre se ferme, puis Ctrl+V sur n'importe quelle page du site. Ou Ctrl+V dans la case pour coller ce que tu as copié sur le site (« Copier pour le jeu ») : chargé, puis fermeture.

La fenêtre complète, ouverte par le **bouton de la minicarte** ou `/fr`, a quatre onglets :

| Onglet | Rôle |
|---|---|
| **Synchro** | En haut : colle ce que tu as copié sur le site (données des groupes ou compo d'un raid), chargé tout seul. En bas : ton export déjà sélectionné, seulement les persos qui ont changé ; Ctrl+C le marque envoyé, Échap ferme |
| **Raids** | Raids à venir de tes groupes et inscription du perso connecté |
| **Compo** | La compo collée : état de chaque perso (bon groupe, à déplacer, absent), **Inviter**, **Placer les groupes** |
| **Patrons** | Patrons et BiS suivis dans tes sacs (**Annoncer**), autres patrons à marquer « recherché » |

| Commande | Rôle |
|---|---|
| Raccourcis (AddOns > Forever Roster) | « Synchro rapide avec le site » et « Ouvrir ou fermer la fenêtre » (`Bindings.xml`) |
| `/fr` | Ouvrir ou fermer la fenêtre |
| `/fr synchro`, `raids`, `compo`, `patrons` | Ouvrir un onglet |
| `/fr cherche <lien>` | Marquer un patron vu ailleurs comme recherché (Maj+clic pour mettre le lien), ou l'en retirer |
| `/fr oublier Nom-Royaume` | Retirer un perso supprimé de l'export |
| `/fr rappels` | Couper ou remettre le rappel de raid à la connexion |
| `/fr minicarte` | Afficher ou masquer le bouton de la minicarte (clic : fenêtre, clic droit : synchro rapide, glisser : déplacer ; pastille : persos à envoyer) |

Rappel de raid : à la connexion, un raid de tes groupes dans les 24 h sans réponse ouvre une petite fenêtre « Tu viens ? » (Présent, En retard, Peut-être, Absent) ; un raid déjà répondu s'affiche dans le chat. Il se base sur les dernières données du site collées en jeu.

Infobulles : « Recherché par », « Connu par », « BiS de » sur les objets suivis. Butin : alerte avec **Annoncer au groupe** quand tu ramasses un patron suivi ou un BiS recherché.

## Installation

Télécharger le zip sur la page **Addon** du site, puis copier le dossier `ForeverRoster` dans `World of Warcraft\_classic_beta_\Interface\AddOns\` (après la sortie : `_classic_`), puis relancer le jeu ou taper `/reload`.

## Notes

- **Patrons :** le jeu ne donne la liste des patrons connus que lorsqu'une fenêtre de métier est ouverte. Ouvre chacune une fois (avec les filtres retirés) avant `/fr export`.
- **Invitations :** hors raid, un groupe ne dépasse pas 5 personnes. L'addon invite les 4 premiers, passe en raid dès que le groupe est formé, puis invite la suite. Les inscrits Discord sans compte sont listés à part, leur pseudo n'étant pas forcément leur nom en jeu.
- **Relevé automatique :** chaque perso est relevé à la connexion et quand il change (équipement, niveau, talents, métiers, fenêtre de métier). Connecte-toi une fois avec un perso pour qu'il entre dans l'export.
- **Inscriptions et patrons recherchés en jeu :** gardés par perso, ils partent au site avec l'export.
- **Butin :** seule ta propre ramasse déclenche l'alerte ; « Annoncer » écrit dans le raid (ou le groupe), sinon dans ton chat.
- **Placement :** chef du raid ou assistant, hors combat. Un déplacement à la fois, au rythme des mises à jour du raid.

## Tests hors jeu

```bash
for f in addon/ForeverRoster/*.lua; do luac5.1 -p "$f"; done
lua5.1 addon/tests/format_test.lua   # formats d'échange avec le site
lua5.1 addon/tests/wow_sim.lua       # API de WoW simulée : chargement de l'addon et commandes
```
