# Addon Forever Roster

Addon WoW pour le client de WoW Forever (interface 16001). Il fait le lien avec le site par copier-coller (un addon n'a pas accès à internet).

| Commande | Rôle |
|---|---|
| `/fr compo` (ou `/fr`) | Coller l'**Export pour le jeu** d'un raid : état de chaque perso (bon groupe, à déplacer, absent), **Inviter**, **Placer les groupes** |
| `/fr export` | Texte à copier puis coller sur la fiche du perso (**Importer depuis l'addon**) : niveau, équipement porté, métiers, patrons connus, talents |
| `/fr talents` | Diagnostic du système de talents de Forever, enregistré dans `SavedVariables\ForeverRoster.lua` au prochain `/reload` |

## Installation

Copier le dossier `ForeverRoster` dans `World of Warcraft\_classic_beta_\Interface\AddOns\` (après la sortie : `_classic_`), puis relancer le jeu ou taper `/reload`.

## Notes

- **Patrons :** le jeu ne donne la liste des patrons connus que lorsqu'une fenêtre de métier est ouverte. Ouvre chacune une fois (avec les filtres retirés) avant `/fr export`.
- **Invitations :** hors raid, un groupe ne dépasse pas 5 personnes. L'addon invite les 4 premiers, passe en raid dès que le groupe est formé, puis invite la suite. Les inscrits Discord sans compte sont listés à part, leur pseudo n'étant pas forcément leur nom en jeu.
- **Placement :** chef du raid ou assistant, hors combat. Un déplacement à la fois, au rythme des mises à jour du raid.

## Tests hors jeu

```bash
for f in addon/ForeverRoster/*.lua; do luac5.1 -p "$f"; done
lua5.1 addon/tests/format_test.lua
```
