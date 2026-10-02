# Addon Forever Roster

Addon WoW pour le client de WoW Forever (interface 16001). Il fait le lien avec le site par copier-coller (un addon n'a pas accès à internet).

Une seule fenêtre, ouverte par le **bouton de la minicarte** ou `/fr`, avec quatre onglets :

| Onglet | Rôle |
|---|---|
| **Raids** | Coller les données du site (page Addon : tous tes groupes) ; raids à venir et inscription du perso connecté |
| **Compo** | Coller l'**Export pour le jeu** d'un raid : état de chaque perso (bon groupe, à déplacer, absent), **Inviter**, **Placer les groupes** |
| **Patrons** | Patrons et BiS suivis dans tes sacs (**Annoncer**), autres patrons à marquer « recherché » |
| **Export** | Texte de **tous** tes persos relevés, à coller sur la page Addon du site |

| Commande | Rôle |
|---|---|
| `/fr` | Ouvrir ou fermer la fenêtre |
| `/fr raids`, `compo`, `patrons`, `export` | Ouvrir un onglet |
| `/fr cherche <lien>` | Marquer un patron vu ailleurs comme recherché (Maj+clic pour mettre le lien), ou l'en retirer |
| `/fr oublier Nom-Royaume` | Retirer un perso supprimé de l'export |
| `/fr minicarte` | Afficher ou masquer le bouton de la minicarte (clic : fenêtre, clic droit : export, glisser : déplacer) |

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
