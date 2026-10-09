# Addon Roster

Addon pour WoW Retail (Midnight, interfaces 120100 et 120105), lié au site Roster (roster.sleyvazh.fr). Comme Forever Roster, il n'a pas accès à internet : les données passent par copier-coller (formats `RRG`, `RRR` et `RRB`, `docs/addon-format.md`, section « Roster : l'addon pour WoW Retail »). Dossier `Roster`, sauvegarde `RosterDB`, commande `/roster`. Il partage avec Forever Roster la boîte à outils `addon/shared` (fenêtres, listes, habillages, police des titres), copiée dans le zip à la construction du site.

**Synchro rapide** : ta touche (onglet **Options**, ou Échap > Options > Raccourcis > AddOns > Roster), le clic droit sur le bouton de la minicarte ou sur Roster dans la liste des addons de la minicarte ouvrent une petite fenêtre avec une seule case. Ce qui part au site (bilans de raid) y est déjà sélectionné : Ctrl+C, la fenêtre se ferme, puis Ctrl+V sur n'importe quelle page du site. Ou Ctrl+V dans la case pour coller ce que tu as copié sur le site : chargé, puis fermeture.

La fenêtre complète, ouverte par le bouton de la minicarte ou `/roster`, a cinq onglets :

| Onglet | Rôle |
|---|---|
| **Synchro** | En haut : colle « Copier pour le jeu » (données des groupes) ou « Export pour le jeu » (compo d'un raid), chargé dès que le texte est complet (message vert, ou rouge s'il est refusé). En bas : le bilan des raids déjà sélectionné ; Ctrl+C le marque envoyé, « Tout renvoyer » pour tout recopier |
| **Raids** | Raids à venir de tes groupes |
| **En raid** | Pendant le raid : qui a l'addon (et sa version), relevé de la présence et du butin, chef de butin et distribution par Roster (0.2.0) |
| **Compo** | La compo collée : **Inviter**, **Placer les groupes** |
| **Options** | Touches (choisir, retirer), habillage (jeu ou site), bouton de la minicarte, relevé de la présence et du butin, seuil de qualité du butin, passer automatiquement quand le chef de butin distribue |

| Commande | Rôle |
|---|---|
| Raccourcis (AddOns > Roster) | « Synchro rapide avec le site (copier / coller) » et « Ouvrir ou fermer la fenêtre » (`Bindings.xml`) |
| `/roster` | Ouvrir ou fermer la fenêtre |
| `/roster synchro`, `raids`, `enraid`, `compo`, `options` | Ouvrir un onglet |
| `/roster inviter` | Inviter les persos de la compo chargée |
| `/roster placer` | Placer les persos dans leurs groupes (chef du raid ou assistant, hors combat) |
| `/roster versions` | Qui a l'addon dans le raid, et sa version |
| `/roster butin` | Fenêtre du chef de butin : objets reçus, conseil, jets MS / OS, jet libre, garder |
| `/roster remettre` | Objets à remettre aux gagnants (échange) ; aussi Maj+clic sur le bouton de la minicarte |
| `/roster test` (ou `essai`) | Raid d'essai seul, hors groupe : le lance, puis affiche ou masque son panneau ; `/roster test fin` l'arrête |
| `/roster minicarte` | Afficher ou masquer le bouton de la minicarte (clic : fenêtre, clic droit : synchro rapide, Maj+clic : objets à remettre, glisser : déplacer ; pastille : envois en attente ; « REC » : relevé en cours ; l'infobulle compte les objets à remettre). Roster reste dans la liste des addons de la minicarte |
| `/roster habillage` | Passer de l'habillage du jeu à celui du site, et inversement (recharge l'interface ; aussi dans Options) |

Relevé du raid : pendant un raid du site chargé en jeu (heure prévue passée depuis moins de 3 h, ou dans moins de 2 h), l'addon note chaque minute qui est dans le groupe de raid, le butin à partir d'une qualité réglable (épique par défaut) et chaque fin de rencontre. « REC » s'affiche sur le bouton de la minicarte. Le bilan (bloc `RRB`) part avec la synchro ; le site ne retient que celui d'un officier du groupe ou du créateur du raid. Le relevé se coupe dans Options (`RosterDB.record = false`, seuil dans `RosterDB.lootQuality` : 3 rare, 4 épique, 5 légendaire).

Habillage : celui du jeu par défaut (cadres de l'interface de WoW, onglets à icône sur le côté), ou celui du site (fond sombre, liserés argent-azur, titres en Marcellus SC, onglets en haut). La police est dans `Fonts/` (licence SIL OFL, `Fonts/OFL.txt`), le logo dans `Media/Logo.tga` : le W au trait et l'épée du logo du site, argent-azur sur un disque bleu nuit (dessin original, TGA 32 bits 128 × 128). Le changement s'applique au rechargement de l'interface.

## Distribution du butin par Roster (0.2.0)

Comme RCLootCouncil : le butin de groupe du jeu va au chef de butin, qui le distribue ensuite (conseil ou jets) et l'échange au gagnant. Pas de soft reserve sur Roster. Messages entre addons et règles : `docs/addon-format.md`, « Distribution par Roster (R3b) ».

- **Chef de butin** : le chef de raid, sauf s'il en désigne un autre (onglet **En raid**). Il active **Distribution par Roster** pour le raid ; elle l'est d'office quand le raid chargé est en mode « conseil » sur le site.
- **Passer automatiquement** : à chaque jet du butin de groupe, ton addon attend que le chef de butin ait pris l'objet (20 s au plus), puis passe pour toi. Si le chef de butin ne l'a pas pris (pas éligible à cet objet…), il ne passe pas et te le dit. Tu peux couper ce passer automatique pour toi dans **Options** (`RosterDB.autoPass = false`) : passe alors toi-même, sinon l'objet peut te revenir au lieu d'aller au chef de butin.
- **Fenêtre du butin** (`/roster butin`, chef de butin) : les objets reçus et le temps qui reste pour les échanger (2 h après le butin, lu dans l'infobulle de l'objet ; en orange quand il presse). Pour chaque objet :
  - **Conseil** (ou **Tout au conseil**, 0.3.0) : chacun reçoit une fenêtre de réponse (BiS, Upgrade, Off-spec, Transmo, Passer, et une note) ; la réponse part avec les objets qu'il porte sur cet emplacement. Sans l'addon, on chuchote « bis », « up », « os » ou « transmo » au chef de butin, suivi du numéro de l'objet s'il y en a plusieurs (« bis 2 »). Le chef de butin relaie chaque réponse au conseil (0.2.1) : seuls lui et les membres du conseil ont besoin des données du site. Le conseil (officiers et propriétaire du groupe, ou celui choisi pour ce raid sur le site) voit les réponses et les objets reçus sur la période (colonne « Reçus »), vote, et le chef de butin donne l'objet.
  - **Jets MS / OS** : MS `/roll 100`, OS `/roll 99` ; le premier jet de chacun compte, la MS passe avant l'OS ; en cas d'égalité, « Relancer » : seuls les ex æquo relancent.
  - **Jet libre** : `/roll 100` pour tous, le plus haut l'emporte.
  - **Garder** : le chef de butin garde l'objet (désenchantement, banque de guilde) ; il ne compte pas dans ses objets reçus.
- **Annonces** : chaque attribution est annoncée dans le canal du raid (« Brumelune reçoit [Objet] (conseil : BiS) ») et chuchotée au gagnant (« Tu reçois [Objet] : passe me voir pour l'échange »).
- **Objets à remettre** (`/roster remettre`, ou Maj+clic sur le bouton de la minicarte, dont l'infobulle les compte) : **Échanger** ouvre l'échange avec le gagnant, à portée, tant que le jeu le permet (2 h, joueurs présents au moment du butin) ; ses objets y sont posés tout seuls (0.3.0), même s'il ouvre l'échange lui-même.
- **Joueurs sans l'addon** : s'ils gagnent un objet au butin de groupe (ils n'ont pas passé), Roster le signale au chef de butin, qui peut leur chuchoter d'un clic de le garder pour l'échange.
- **Bilan pour le site** : l'objet distribué part avec son gagnant, la méthode (conseil, jets, ou gardé par le chef de butin), la réponse et le détail (« 3 votes », « MS 87 », « jet 54 », « gardé ») : lignes `L` du bloc `RRB`. Le bilan du chef de butin compte comme celui du chef de raid, et le relevé des autres joueurs note aussi les gagnants (message `LW`).

### Retours du test (0.3.0)

- **Tout au conseil** : dans la fenêtre du butin, « Tout au conseil (N) » propose d'un coup tous les objets à distribuer (dès 2), avec une seule annonce numérotée. Sans l'addon, on chuchote la réponse suivie du numéro (« bis 2 »).
- **Bande d'objets** : en haut des fenêtres « ta réponse » et du conseil, un bouton par objet (numéro, icône, infobulle). Après une réponse, l'objet suivant sans réponse ; tout répondu, la fenêtre reste ouverte (« Fermer ») et tes réponses restent modifiables tant que le conseil est ouvert (un seul objet : elle se ferme, comme avant). Conseil : « 12/20 » réponses, puis coche et gagnant ; « Donner » passe au conseil suivant.
- **Objets portables** : pour un objet que tu ne peux pas porter (armure d'un autre type, ou ligne rouge de l'infobulle), seulement Transmo et Passer, avec la raison. Au conseil, la réponse d'un joueur qui ne peut pas porter cette armure est grisée, avec « ne peut pas le porter ».
- **Détail des reçus** : la colonne « Reçus » du conseil montre le total et le détail (« 2 BiS · 3 Up · 1 MS ») ; infobulle : site, ce soir, ce qui ne compte pas. Clic sur l'en-tête : tri par objets reçus (le moins servi d'abord).
- **Échange** : les objets du gagnant sont posés tout seuls dès que la fenêtre d'échange s'ouvre avec lui, même s'il l'ouvre lui-même.

### Raid d'essai (`/roster test`)

Pour tout essayer seul, hors groupe (l'essai s'arrête si tu rejoins un groupe) : tu es chef de butin d'un raid fictif, toi et 9 joueurs (Kaeldra-Hyjal et Tharok-Hyjal en tanks ; Brumelune-Ysondre, Thessaly-Ysondre et Orvane-Hyjal, sans l'addon, en soins ; Vex-Kael'Thas, Lysenn-Dalaran, Mirwen-Hyjal et Ashlen-Hyjal en dégâts). Tharok et Brumelune sont au conseil avec toi. Un panneau propose les étapes :

1. **Recevoir 3 objets** : ceux que tu portes (infobulles du jeu), 1 h 52 pour les échanger, 25 min pour le troisième (en orange).
2. **Tout au conseil** : les 3 objets d'un coup. Chacun répond à chaque objet avec ses objets portés (Transmo ou Passer si ce n'est pas l'armure de sa classe), Orvane te chuchote « bis 1 », Tharok et Brumelune votent sur chaque objet : passe d'un objet à l'autre par la bande, vote pour départager, puis « Donner » (la fenêtre passe au conseil suivant).
3. **Jets MS / OS** : Ashlen et Vex font 87 : « Relancer » dans la fenêtre du butin, ils relancent (un objet de plus arrive s'il ne reste rien à distribuer).
4. **Jet libre**, 5. **Garder**, 6. **Objets à remettre** : l'échange est simulé (il réussit).
7. **Joueur sans l'addon** : Orvane gagne un objet au butin de groupe sans avoir passé ; chuchote-lui de le garder.
8. **Côté joueur** : Tharok, chef de butin fictif, te propose deux objets d'un coup, le second d'une autre armure (seulement Transmo ou Passer) : la fenêtre de réponse des joueurs et sa bande ; tu peux changer une réponse tant qu'il n'a pas terminé.

Rien ne part au chat du raid, aux autres joueurs ni au site : annonces, chuchotements et jets s'affichent dans ta fenêtre de chat, précédés de « [essai] ». `/roster test` affiche ou masque le panneau ; « Quitter l'essai » ou `/roster test fin` l'arrête. Le vrai butin de groupe (passer automatiquement), l'échange et les annonces restent à vérifier dans un vrai raid.

## Installation

Télécharger le zip sur la page **Addon** de Roster, puis copier le dossier `Roster` dans `World of Warcraft\_retail_\Interface\AddOns\`, puis relancer le jeu ou taper `/reload`.

## Tests hors jeu

```bash
for f in addon/Roster/*.lua addon/shared/*.lua; do luac5.1 -p "$f"; done
lua5.1 addon/tests/roster_format_test.lua   # formats RRG, RRR, RRB et noms « Prénom-Royaume » (écrit sample.rrb, relit sample.rrg et sample.rrr du site)
lua5.1 addon/tests/roster_sim.lua           # jeu simulé : compo, invitations, placement, versions, file des messages, relevé et bilan
lua5.1 addon/tests/roster_ui_test.lua       # fenêtre, commandes, synchro rapide, options, minicarte, fenêtres du butin (bandes d'objets), raid d'essai de bout en bout
```

Les simulations chargent les fichiers du `.toc` dans l'ordre (dossier de l'addon, puis `addon/shared`) ; les variables de Blizzard ne doivent jamais être réassignées, et aucune valeur secrète du jeu (12.x) ne doit finir dans la sauvegarde.

**À vérifier en jeu (0.1.0)** : invitations `Prénom-Royaume` (même royaume et autres royaumes), passage en raid pendant que des invitations sont en attente, placement des groupes, réponses des versions et file d'attente pendant un boss (`SendAddonMessage` renvoie `AddOnMessageLockdown`), textes du butin en français dans le chat (butin de groupe et butin personnel), noms avec ou sans royaume dans les messages des addons.

**À vérifier en jeu (0.2.0)** : passer automatique quand le chef de butin a pris l'objet, et rien (avec le message) quand il ne l'a pas pris ; option coupée ; chef de butin désigné par le chef de raid ; fenêtre de réponse chez chacun, réponse chuchotée par un joueur sans l'addon, votes du conseil ; jets lus dans le chat et relance des ex æquo ; minuteur d'échange lu dans l'infobulle et échange avec le gagnant ; annonce au raid et chuchotement au gagnant, aussi pendant et juste après un boss (messages retenus) ; joueur sans l'addon qui gagne au butin de groupe ; raid d'essai avec tes objets portés (infobulles, niveaux d'objet), puis arrêt en rejoignant un groupe.

**À vérifier en jeu (0.3.0)** : « Tout au conseil » sur 5 objets ou plus (une seule annonce, numéros, « bis 2 » chuchoté) ; bande d'objets dans les deux habillages (icônes, coches, infobulles, flèches quand elle déborde, fenêtre redimensionnée) ; passage à l'objet suivant après une réponse et au conseil suivant après « Donner » ; nouvel objet qui arrive pendant une réponse ; objet d'une autre armure, arme ou jeton réservé à d'autres classes (seulement Transmo et Passer, raison) ; « ne peut pas le porter » au conseil ; colonne « Reçus » (total, détail sur deux lignes, infobulle, tri par l'en-tête) ; objets posés tout seuls quand le gagnant ouvre l'échange.
