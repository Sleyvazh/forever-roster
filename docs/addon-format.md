# Formats d'échange entre le site et l'addon

L'addon Forever Roster (`addon/ForeverRoster`) n'a pas accès à internet : les données passent par copier-coller.

- **FRR** (site → jeu) : la page d'un raid propose un **Export pour le jeu**, à coller dans l'addon (`/fr compo`), et des macros `/inv`.
- **FRC** (jeu → site) : `/fr export` affiche un texte à coller sur la fiche du perso (**Importer depuis l'addon**).

Ce document fixe ces formats, pour que l'addon et le site évoluent sans se casser.

# FRR, version 1 : compo d'un raid

## Principes

- **Une information par ligne, champs séparés par `;`.** En Lua : `strsplit(";", ligne)`.
- **Aucun `|`**, caractère d'échappement de WoW (liens, couleurs). Le site retire `|`, `;` et les retours à la ligne des noms.
- **Versionné** : la première ligne donne la version. Un addon qui lit une version plus récente qu'il ne connaît doit le dire, pas deviner.
- **Complet** : la dernière ligne donne le nombre de membres. Cela détecte un copier-coller tronqué.

## Lignes

```
FRR;1;<id du raid>;<date unix, 0 si non fixée>;<nom du raid>
M;<nom>;<CLASSE>;<rôle>;<spé>;<groupe>;<place>;<statut>;<source>
…
END;<nombre de lignes M>
```

| Champ | Valeurs |
|---|---|
| `CLASSE` | Jeton de classe du jeu : `WARRIOR`, `PALADIN`, `HUNTER`, `ROGUE`, `PRIEST`, `SHAMAN`, `MAGE`, `WARLOCK`, `DRUID` |
| `rôle` | `Tank`, `Heal`, `DPS`, ou vide |
| `spé` | Intitulé du site (`Feral Bear`, `Holy Heal`…), ou vide |
| `groupe`, `place` | 1–8 et 1–5 pour un perso placé ; `0;0` pour un inscrit pas encore placé |
| `statut` | `present`, `late`, `tentative`, `alt`, `bench`, ou vide (placé sans être inscrit). Les absents ne sont pas exportés. |
| `source` | `site` : perso d'un compte du site (nom en jeu fiable). `discord` : inscription libre, le « nom » est le pseudo Discord. |

Nom de famille : Forever permet d'en ajouter un (« Greta Coulé »), mais le jeu n'utilise que le prénom pour les invitations et `UnitName`. Le site n'exporte donc que le prénom des persos `site`, et l'addon ignore ce qui suit le premier espace.

Ordre : placés par groupe puis par place, puis non placés par nom.

## Exemple

```
FRR;1;4a1e43ea-54e8-4b49-888f-5e19b5754f61;1794513600;Molten Core
M;Tournicoti;DRUID;Tank;Feral Bear;1;1;present;site
M;Givrette;MAGE;DPS;Frost;1;2;late;site
M;Bob;PRIEST;Heal;Holy Heal;0;0;tentative;discord
END;3
```

## Lecture en Lua (esquisse)

```lua
local function ParseFRR(text)
  local raid, members, count = nil, {}, nil
  for line in text:gmatch("[^\r\n]+") do
    local f = { strsplit(";", line) }
    if f[1] == "FRR" then
      if tonumber(f[2]) ~= 1 then return nil, "Version d'export non gérée : " .. tostring(f[2]) end
      raid = { id = f[3], time = tonumber(f[4]), name = f[5] }
    elseif f[1] == "M" then
      members[#members + 1] = { name = f[2], class = f[3], role = f[4], spec = f[5],
        group = tonumber(f[6]), pos = tonumber(f[7]), status = f[8], source = f[9] }
    elseif f[1] == "END" then
      count = tonumber(f[2])
    end
  end
  if not raid or count ~= #members then return nil, "Export incomplet" end
  return raid, members
end
```

Pour placer les joueurs, l'addon utilise `SetRaidSubgroup` / `SwapRaidSubgroup` (hors combat), en comparant `groupe` au sous-groupe actuel de chaque nom.

## Évolutions

Tout ajout se fait **en fin de ligne** ou avec un **nouveau type de ligne**, ignoré par les anciens addons. Tout changement incompatible passe en version 2. Le générateur est `addonExport` dans `packages/game-data/src/addon.ts`, testé dans `time.test.ts`.

## Macros d'invitation

Une macro WoW est limitée à 255 caractères. Le site découpe donc les `/inv Nom` en plusieurs macros, persos placés uniquement.

# FRC, version 2 : les persos, du jeu vers le site

L'addon relève chaque perso tout seul (connexion, changement d'équipement, de niveau, de talents ou de métier, fenêtre de métier ouverte, déconnexion) et garde ces relevés dans sa sauvegarde, commune au compte. L'onglet **Synchro** donne un bloc par perso **qui a changé depuis son dernier envoi** (« Tout renvoyer » pour tous) ; Ctrl+C dans ce texte le marque comme envoyé (empreinte du contenu gardée par perso), et le bouton de la minicarte affiche le nombre de persos à envoyer. Sur le site, Ctrl+V hors d'un champ, sur n'importe quelle page, ouvre la mise à jour (fiche retrouvée par le choix précédent, sinon le prénom et la classe, ou créée) ; la fiche d'un perso n'applique que le sien. Un bloc abîmé est signalé sans bloquer les autres. La date de dernière synchro est notée sur chaque fiche.

La version 2 est le format court : listes séparées par des virgules, seulement les talents pris. Le site lit toujours la version 1 (une ligne par objet, patron et talent).

```
FRC;2;<nom>;<royaume>;<CLASSE>;<race>;<niveau>;<faction>;<date unix>;<version de l'addon>
G;<emplacement>:<objet>,<emplacement>:<objet>,…
P;<métier ou compétence>;<rang>;<rang max>
R;<métier>;s<sort>,i<objet>,…
T;<arbre>;<nœud>:<rang>,<nœud>:<rang>,…
S;<groupe>;<raid>;<statut>
W;<objet patron>;<1 | 0>
K;<objet>:<quantité>,<objet>:<quantité>,…
END;<nombre de lignes entre l'en-tête et END>
```

| Ligne | Contenu |
|---|---|
| en-tête | `CLASSE` : jeton du jeu (`DRUID`…). `race` : jeton du jeu (`Tauren`, `Scourge` pour Undead, `NightElf`…). |
| `G` | Objets portés : emplacement du jeu (1 tête, 2 cou, 3 épaules, 15 dos, 5 torse, 9 poignets, 10 mains, 6 taille, 7 jambes, 8 pieds, 11-12 doigts, 13-14 bijoux, 16 main droite, 17 main gauche, 18 distance), identifiant de l'objet. Chemise et tabard ne sont pas exportés. |
| `P` | Compétences du perso, nom tel qu'affiché par le jeu. Le client Forever n'a pas la liste des compétences de Classic : l'addon lit `GetProfessions` s'il existe, et sinon la compétence vue à l'ouverture de chaque fenêtre de métier. Le site reconnaît les métiers en anglais et en français et ignore le reste (armes, langues…). |
| `R` | Patron connu, relevé à l'ouverture des fenêtres de métier : `s` + sort de fabrication, ou `i` + objet fabriqué quand le jeu ne donne que lui. Les fenêtres que le site ne gère pas (ex. Poisons du voleur) sont ignorées et signalées à l'import. |
| `T` | Talents pris (système de talents de Forever, `C_Traits`), par arbre : identifiant du nœud et rang. En version 1 : une ligne par nœud, avec rang max, position, sort, sous-arbre et arbre. |
| `W` | Patron marqué « recherché » en jeu (`1`) ou retiré (`0`) : onglet Patrons ou `/fr cherche <lien>`. Le site retrouve la recette enseignée par l'objet ; un patron déjà connu n'est jamais rétrogradé. |
| `S` | Inscription faite en jeu (onglet Raids) : identifiant du groupe, du raid, statut (`present`, `late`, `tentative`, `absent`). Le site l'enregistre pour ce perso ; une ligne par raid, la dernière l'emporte. L'addon envoie la ligne jusqu'à ce que les données du site (FRG) montrent ce statut, ou soient plus récentes que l'accusé de réception, puis l'oublie (1.5.4) : un changement fait ensuite sur le site n'est pas écrasé. |
| `K` | Lot G : consommables demandés par les raids chargés (lignes `C` du FRG), comptés dans les sacs et la banque (`GetItemCount`, banque incluse si elle a été ouverte) à la connexion, quand les sacs changent et à l'ouverture de la banque. Le site les garde sur la fiche (onglet Préparation des raids). |

Le générateur est `Format.lua` (`BuildFRC`), le lecteur `parseCharacterExport` dans `packages/game-data/src/charexport.ts`. Le test Lua (`addon/tests/format_test.lua`) écrit `addon/tests/sample.frc`, que le test du site relit : les deux côtés sont vérifiés sur le même texte.

# FRG, version 1 : données des groupes, du site vers le jeu

Sur le site : « Copier pour le jeu », en haut de chaque page (un bloc FRG par groupe, à la suite), ou un seul groupe depuis son onglet **Raids**. En jeu : synchro rapide (raccourci clavier ou clic droit sur le bouton de la minicarte) ou onglet **Synchro** (`/fr synchro`), Ctrl+V : chargé dès que le texte collé est complet. La zone de collage reconnaît aussi l'« Export pour le jeu » d'un raid (FRR, onglet Compo). Plusieurs groupes remplacent ceux déjà chargés ; un seul groupe est ajouté ou mis à jour. Le texte est propre à chaque joueur (il contient ses inscriptions) et se régénère à la demande.

```
FRG;1;<groupe>;<généré le>;<nom du groupe>
R;<raid>;<date>;<nom>;<mon statut>;<mon perso>;<mode de butin>
P;<objet patron>;<recette>;<recherché par>;<connu par>
B;<objet>;<persos qui l'ont en BiS>
S;<raid>;<objet>;<perso>:<bonus SR+>,…
O;<persos des officiers>
C;<raid>;<objet>;<quantité>;<pour>;<nom de l'objet>
F;<raid>;<n° de fiche>;<rencontre>;<PNJ>,<PNJ>;<nom du boss>
T;<raid>;<n° de fiche>;<intitulé>;<persos>;<consigne>
L;<raid>;<persos du conseil>
I;<raid>;<perso>;<Tank | Heal | DPS>;<melee | ranged | caster>
N;<période courte>;<période>;<perso>+<perso>:<nombre>,…
END;<nombre de lignes R, P et B>
```

| Ligne | Contenu |
|---|---|
| `R` | Raid à venir (ou commencé depuis moins de 3 h ; ceux sans date à la fin), 15 au plus. Date en secondes Unix (0 : à définir). Mon inscription sur le site et le prénom du perso choisi, vides si je ne suis pas inscrit. |
| `B` | Objet BiS choisi dans la base pour un perso du groupe, pas encore obtenu ni porté : prénoms séparés par des virgules. Infobulle « BiS de », liste des sacs et alerte au butin. |
| `R` (7e champ) | Mode de butin du raid (lot C2) : `journal`, `council` ou `softres`. Ignoré par les addons avant 1.0. |
| `S` | Soft reserve d'un raid : objet réservé et persos qui l'ont réservé, chacun avec son bonus SR+ (0 sans bonus). |
| `O` | Membres du conseil (loot council) : persos joués dans le groupe par le propriétaire et les officiers. |
| `C` | Lot G : consommable demandé pour le raid (onglet Préparation), quantité, et à qui : `all`, `tank`, `heal`, `melee`, `ranged` ou `caster` (DPS lanceurs de sorts). |
| `F`, `T` | Lot G : fiche de boss (attributions) : rencontre du jeu (`ENCOUNTER_START`) et PNJ du boss pour le reconnaître en ciblant, puis une ligne `T` par tâche (intitulé, prénoms, consigne). Les fiches vides ne sont pas envoyées. |
| `L` | Lot G : conseil du butin choisi pour ce raid (persos de ses membres) ; sans `L`, le conseil est celui de la ligne `O`. |
| `I` | Lot G : inscrits qui viennent (ou hésitent), avec le rôle et le type de DPS de leur spé, pour savoir quels consommables chacun doit avoir. Seulement pour les raids qui demandent des consommables. |
| `P` | Patron suivi : identifiant de l'objet « Patron / Plans / Recette » tel qu'il est dans les sacs, nom de la recette, prénoms des persos du groupe qui le **recherchent** puis qui le **connaissent**, séparés par des virgules. Comme l'onglet Artisans, seuls les métiers actuels des persos comptent. |
| `N` | Lot I : objets reçus (spé principale, exclusions et corrections des officiers comprises) sur la période du groupe : libellé court (`saison`, `30 j`, `5 raids`), libellé complet (`depuis le 05/11/2026`…), puis une entrée par joueur (ses persos du groupe joints par `+`, main d'abord, qui partagent le compte) ou par perso, selon le réglage du groupe. Colonne « Reçus » du conseil du butin. |

Les lignes `S`, `O`, `C`, `F`, `T`, `L`, `I` et `N` viennent après les autres et **ne sont pas comptées par `END`** : un addon plus ancien les ignore sans signaler de texte incomplet. Avec la soft reserve cachée, un membre ne reçoit que ses propres réservations (les officiers les reçoivent toutes).

L'addon s'en sert pour :

- **s'inscrire en jeu** : statut choisi par perso, envoyé au site par la ligne `S` du prochain `/fr export` ;
- **les infobulles** : « Recherché par / Connu par » sur l'objet patron, partout (sacs, butin, hôtel des ventes, lien dans le chat) ;
- **les sacs** : liste des patrons suivis présents, avec un bouton **Annoncer** ;
- **le butin** : quand on ramasse un patron suivi ou un BiS recherché, une fenêtre indique qui le recherche, avec **Annoncer au groupe** (message dans le raid ou le groupe, avec le lien de l'objet).



# FRB, versions 1 et 2 : bilan d'un raid (jeu → site)

Pendant un raid prévu sur le site (raid chargé en jeu avec « Copier pour le jeu », heure prévue passée depuis moins de 3 h ou dans moins de 2 h), l'addon relève chaque minute les membres du groupe de raid, et note le butin vu dans le chat (`CHAT_MSG_LOOT`) à partir d'une qualité réglable (épique par défaut), avec le dernier boss vaincu (`ENCOUNTER_END`, 15 min). Le bilan suit les blocs FRC dans l'export de la synchro.

```
FRB;1;<id du raid du site>;<début unix>;<fin unix>;<relevé par>;<nom du raid>
A;<prénom en jeu>;<vu la 1re fois unix>;<vu la dernière fois unix>;<nombre de relevés>
L;<id de l'objet>;<reçu par>;<heure unix>;<boss ou vide>
END;<nombre de lignes A et L>
```

**Version 2 (lot C2)** : l'en-tête ajoute l'instance (nom renvoyé par le jeu), et `L` la façon dont l'objet a été attribué.

```
FRB;2;<id du raid du site>;<début unix>;<fin unix>;<relevé par>;<nom du raid>;<instance>
L;<id de l'objet>;<reçu par>;<heure unix>;<boss>;<méthode>;<réponse>;<détail>
```

**Lot G (addon 1.0)** : l'addon écrit la version 2. Hors du compte de `END`, l'appel aux consommables lancé en raid :

```
Q;<heure unix>;<lancé par>
K;<prénom>;<objet>:<quantité>,…   (ou « - » : pas de réponse, pas d'addon)
```

**Lot K1 (addon 1.3)** : 9e champ de l'en-tête, `1` si celui qui a relevé est le chef de raid (il a distribué du butin avec l'addon, ou menait le raid au moins la moitié des relevés), `0` sinon. Roster Companion n'envoie tout seul que le bilan du chef ; un envoi automatique d'un autre officier ne remplace pas ce bilan (réponse `kept`). Collé à la main, le dernier bilan remplace toujours le précédent.

Méthode : `council`, `sr`, `roll`, `ml` (maître du butin) ou vide ; réponse au conseil : `bis`, `upgrade`, `off`, `transmo` ou vide ; détail libre (« 3 votes », « jet 87 + 10 »). Le site lit les versions 1 et 2. Chaque bilan alimente aussi le **catalogue de butin** (objet, boss, instance ; aucune donnée de joueur), qui sert à proposer les objets d'un raid en soft reserve : les tables de butin ne sont pas dans les fichiers du jeu.

Sur le site (Ctrl+V n'importe où), le bilan est enregistré sur le raid (un nouveau collage le remplace), seulement par un officier du groupe ou le créateur du raid. Les prénoms sont rapprochés des fiches des membres. Statuts : présent ; en retard (arrivé plus de 10 min après l'heure prévue) ; parti tôt (absent du dernier quart de la soirée, au moins 15 min) ; banc (inscription « banc ») ; inscrit, absent (inscrit présent ou en retard, jamais vu). Un objet reçu qui est l'objectif BiS d'une fiche y est coché « obtenu ».


# Messages entre addons (lot G, addon 1.0)

Préfixe `FRoster`, champs séparés par « ; », canal du raid (ou du groupe) sauf mention. Rien ne passe par le site.

| Message | Sens | Contenu |
|---|---|---|
| `VQ` / `VR;<version>` | tous | Qui a l'addon : question à l'arrivée dans un raid (ou « Redemander »), chacun répond avec sa version. |
| `CQ;<objets>` | chef → raid | Appel aux consommables ; chacun répond en privé `CR;<objet>:<quantité>,…` (sacs et banque). Clos après 8 s ; résultat gardé avec le bilan (`Q`, `K`). |
| `LO;<session>;<objet>;<nom>` | maître du butin → raid | Objet proposé au conseil : fenêtre de réponse chez chacun. Le nom (1.2, ignoré avant) s'affiche tant que le jeu ne connaît pas encore l'objet. |
| `LA;<session>;<réponse>;<objets portés>;<note>` | joueur → conseil (privé) | Réponse : `bis`, `upgrade`, `off`, `transmo` ou `pass`. Sans addon : chuchoter « bis », « up », « os » ou « transmo » au maître du butin. |
| `LV;<session>;<candidat>` | conseil → conseil (privé) | Vote (vide : vote retiré). |
| `LC;<session>;<gagnant>` | maître du butin → raid | Conseil terminé : les fenêtres de réponse se ferment. |

Les jets (soft reserve, MS / OS, jet libre) passent par `/roll` : l'addon du maître du butin lit le message du jeu (`RANDOM_ROLL_RESULT`, dans la langue du client), ne compte que le premier jet de chacun et le bon dé (100, ou 99 en OS), ajoute le bonus SR+ ; en cas d'égalité, seuls les ex æquo relancent.


# Roster Companion (lots K1 à K3, addon 1.3 et 1.4)

L'appli (en option, `apps/companion`) fait la synchro sans copier-coller, avec les mêmes formats. Le jeu écrit la sauvegarde de l'addon à la déconnexion et au `/reload` ; il lit les fichiers d'addon à la connexion, au `/reload`, et au chargement d'un addon chargé à la demande (voir « Actualisation sans /reload »).

**Du jeu vers le site.** À `PLAYER_LOGOUT` (aussi déclenché par `/reload`), l'addon écrit dans sa sauvegarde (`WTF\Account\<compte>\SavedVariables\ForeverRoster.lua`) :

```lua
ForeverRosterDB.outbox = { v = 1, at = <unix>, addon = "1.3.0", blocks = {
  { kind = "frc", key = "Tournicoti-Forever EU", sig = "<empreinte>", text = "FRC;2;…\nEND;7" },
  { kind = "frb", key = "frb:<id du raid>", sig = "<log.updated>", lead = true, text = "FRB;2;…;1\n…\nEND;12" },
} }
```

Seulement ce qui a changé depuis le dernier envoi (comme l'onglet Synchro). L'appli lit ce fichier sans l'exécuter, envoie les blocs à `POST /api/sync/upload` (`{ text, create, ignore, manual }`) et n'envoie tout seul un bloc `frb` que si `lead` est vrai. Un bilan qui n'est pas celui du chef est proposé dans l'appli (« Bilan à envoyer à la main », bouton « Envoyer ») : envoyé avec `manual: true`, il remplace le bilan du site, comme un Ctrl+V. Réponse : un résultat par bloc (`updated`, `created`, `unknown` : perso que le site ne connaît pas, à créer ou ignorer ; `ignored`, `kept`, `refused`, `error`).

**Du site vers le jeu.** `GET /api/sync/frg` donne le même texte que « Copier pour le jeu » (tous les groupes du jeu de l'adresse appelée), avec un `ETag` qui ne change qu'avec les données. L'appli l'écrit, avec les accusés de réception, dans l'addon séparé `ForeverRoster_Data` (`Data.lua`), que l'addon principal lit à `PLAYER_LOGIN` (`## OptionalDeps: ForeverRoster_Data`) :

```lua
ForeverRosterData = { v = 1, at = <unix>, app = "0.1.0",
  frg = "FRG;1;…", frgAt = <unix>,              -- "" : plus aucun groupe
  acks = { ["Tournicoti-Forever EU"] = "<empreinte>", ["frb:<id du raid>"] = "<log.updated>" },
  report = { at = <unix>, items = { "Tournicoti", "bilan de « Vroum Vroum »" } } }
```

- `frg` remplace tous les groupes chargés, sans message, s'il est plus récent que le dernier chargement (un collage manuel plus récent est gardé).
- `acks` : le perso est marqué envoyé (`sentSig`), le bilan aussi (`sentAt`) ; le compteur de la minicarte retombe.
- `report` : affiché dans l'onglet Synchro (« Roster Companion s'en occupe »), textes nettoyés des codes du jeu. L'appli est considérée active si `at` date de moins de 3 jours.
- Toutes les chaînes sont écrites par l'appli en chaînes Lua échappées octet par octet (`\\`, `\"`, `\ddd`), jamais en crochets longs.

**Actualisation sans /reload (lot K3, addons 1.4 et 1.5).** L'appli écrit le même `Data.lua` dans 20 copies, `ForeverRoster_Data1` à `ForeverRoster_Data20` (9 avec l'appli 0.1.0), avec `## LoadOnDemand: 1`. Le jeu lit les fichiers d'un addon chargé à la demande au moment où on le charge, mais il ne voit que les fichiers présents à son lancement (vérifié sur le client de Forever : un fichier créé jeu ouvert reste inconnu) ; l'addon ne peut donc pas savoir quand l'appli a du nouveau. Charger la copie suivante (`C_AddOns.LoadAddOn`) remplace `ForeverRosterData`, puis l'addon applique les données comme à la connexion. Chaque copie ne se charge qu'une fois par session : 20 actualisations, puis il faut un `/reload` (qui remet le compte à zéro). Quand l'addon charge une copie (1.5) :

- tout seul, si la dernière actualisation (ou la connexion) date d'au moins 2 minutes : à l'ouverture de sa fenêtre, 30 et 5 minutes avant chaque raid chargé (vérifié toutes les 30 s), à l'appel (`READY_CHECK`), en entrant dans un groupe de raid ou dans une instance de raid, et au moins toutes les heures (1.5.1) ; message dans le chat seulement s'il y a du nouveau dans les groupes ;
- les 20 copies utilisées : le jeu n'autorise le rechargement de l'interface qu'après un clic ou une touche du joueur (`C_UI.Reload`, restreint) ; l'addon affiche donc une fenêtre « Recharger / Plus tard », hors combat, au plus une fois par heure (1.5.1) ;
- à la demande : « Charger les nouveautés » (onglet Synchro), sa touche (Échap > Options > Raccourcis > AddOns) ou `/fr actualiser` ;
- en combat, l'actualisation attend la fin du combat.

« Synchroniser » (onglet Synchro), sa touche ou `/fr synchroniser` rechargent l'interface (hors combat) : la sauvegarde est écrite (l'appli envoie au site dans les secondes qui suivent) et les données de l'appli rechargées, sans limite. Pendant que le jeu tourne, l'appli relève le site toutes les minutes. Les dossiers sont créés avec `ForeverRoster_Data` : le jeu ne voit un nouveau dossier d'addon qu'après avoir été relancé. Dans la liste des addons du jeu, les copies sont rangées sous l'en-tête repliable « Roster Companion » (`## Category`), « Copie 01 » à « Copie 20 » (appli 0.2.1).

**Fichiers servis par le site** : `/downloads/ForeverRoster.zip` et `/downloads/ForeverRoster.json` (`name`, `file`, `version`, `interface`, `sha256`, `size`), lus par l'appli pour installer ou mettre à jour l'addon.

# Roster : l'addon pour WoW Retail (lot R3)

Addon à part (`addon/Roster`, titre « Roster », sauvegarde `RosterDB`, commande `/roster`), servi par roster.sleyvazh.fr (`/downloads/Roster.zip` et `Roster.json`). Il partage avec Forever Roster la boîte à outils `addon/shared` (fenêtres, listes, habillages, police des titres), copiée dans chaque zip à la construction du site. Interfaces annoncées : `120100, 120105` (12.1.0 et 12.1.5).

Mêmes principes que les formats de Forever (une information par ligne, `;`, aucun `|`, version en tête, `END` qui compte les lignes, ajouts en fin de ligne ou nouveaux types de ligne). Les en-têtes commencent par `RR` : un texte de Roster collé dans Forever Roster (ou l'inverse) est reconnu et refusé avec un message clair, jamais mal lu.

**Noms en jeu** : toujours `Prénom-Royaume`, royaume normalisé comme le jeu (`GetNormalizedRealmName`) : nom du royaume sans espaces, tirets ni points, apostrophes gardées (« Conseil des Ombres » → `ConseildesOmbres`, « Kael'Thas » → `Kael'Thas`). Pour comparer, l'addon et le site ignorent la casse, les accents, les apostrophes, les espaces, les tirets et les points du royaume (le premier tiret sépare le prénom du royaume). Le site génère ces noms avec `normalizedRealm()` et `fullName()` (`packages/game-data/src/roster-addon.ts`), l'addon avec `ns.Format.FullName` (`addon/Roster/Format.lua`).

**Classes** : jetons du jeu `WARRIOR`, `PALADIN`, `HUNTER`, `ROGUE`, `PRIEST`, `DEATHKNIGHT`, `SHAMAN`, `MAGE`, `WARLOCK`, `MONK`, `DRUID`, `DEMONHUNTER`, `EVOKER`. **Spés** : clé anglaise du site (`Beast Mastery`, `Devourer`…). **Difficultés** : `normal`, `heroic`, `mythic`.

## RRG, version 1 : données des groupes (site → jeu)

« Copier pour le jeu » sur Roster (barre du haut), collé dans l'onglet Synchro de l'addon (ou sa synchro rapide). Un bloc par groupe de WoW Retail, à la suite.

```
RRG;1;<groupe>;<généré le unix>;<nom du groupe>
R;<raid>;<date unix, 0 : à définir>;<nom>;<difficulté>;<effectif>;<mon statut>;<mon perso Prénom-Royaume>;<mode de butin>
END;<nombre de lignes R>
```

Mêmes raids que FRG (à venir ou commencés depuis moins de 3 h, puis sans date ; 15 au plus). `mon statut` et `mon perso` vides si je ne suis pas inscrit. Mode de butin sur Roster : `journal` (le butin est seulement noté) ou `council` (distribution par Roster : conseil, jets). **Pas de soft reserve sur Roster** (choix de Flo, 07/10).

**Lot R3b (addon 0.2)**, après les `R`, hors du compte de `END` (un addon 0.1 les ignore) :

```
O;<persos des officiers et du propriétaire, Prénom-Royaume, séparés par des virgules>
L;<raid>;<persos du conseil choisis pour ce raid, Prénom-Royaume, virgules>
N;<période courte>;<période>;<perso>+<perso>:<nombre>,…
```

- `O` : conseil du butin par défaut (persos joués dans le groupe par le propriétaire et les officiers).
- `L` : conseil choisi pour ce raid sur le site (onglet Butin du raid) ; sans `L`, le conseil est celui de `O`.
- `N` : objets reçus sur la période du groupe (colonne « Reçus » du conseil), comme FRG : libellé court (`saison`, `30 j`, `5 raids`), libellé complet, puis une entrée par joueur (ses persos du groupe joints par `+`, main d'abord) ou par perso. Même règle que la colonne « Reçus » du site (`lootSkipReason`) : tout compte sauf une réponse Off-spec ou Transmo, un jet OS ou libre, un objet gardé par le chef de butin (`ml`, détail « gardé ») et ce qu'un officier exclut. Un objet donné directement par le chef de butin (`ml`) compte. L'addon y ajoute les objets de ce soir (bilan en cours), même règle, sans ceux que le chef de butin n'a pas encore distribués.

Ordre : `O`, puis un `L` par raid (dans l'ordre des `R`), puis `N`. Lignes vides omises (pas de `O` sans officier, pas de `L` si aucun membre du conseil choisi n'a de perso dans le groupe : l'addon prend alors `O`).

## RRR, version 1 : compo d'un raid (site → jeu)

« Export pour le jeu » de l'onglet Compo d'un raid de Roster, collé dans l'onglet Synchro (ou Compo) de l'addon.

```
RRR;1;<raid>;<date unix, 0 si non fixée>;<nom du raid>;<difficulté>;<effectif>
M;<Prénom-Royaume>;<CLASSE>;<rôle>;<spé>;<groupe>;<place>;<statut>;<source>
END;<nombre de lignes M>
```

Comme FRR : `rôle` `Tank`, `Heal`, `DPS` ou vide ; `groupe` 1–8 et `place` 1–5 (`0;0` : inscrit pas encore placé) ; `statut` `present`, `late`, `tentative`, `alt`, `bench` ou vide ; `source` `site` ou `discord` (pour `discord`, le nom est le pseudo Discord, à inviter à la main). Ordre : placés par groupe et place, puis non placés par nom. Les macros d'invitation du site utilisent `/inv Prénom-Royaume`.

## RRB, version 1 : bilan d'un raid (jeu → site)

Relevé par l'addon pendant un raid chargé (même fenêtre que FRB : heure prévue passée depuis moins de 3 h, ou dans moins de 2 h ; un relevé commencé continue tant que le joueur reste dans le groupe de raid, jusqu'à 6 h après l'heure prévue). Il part avec la synchro rapide (onglet Synchro), collé sur Roster (Ctrl+V n'importe où), enregistré par un officier du groupe ou le créateur du raid.

```
RRB;1;<raid>;<début unix>;<fin unix>;<relevé par Prénom-Royaume>;<nom du raid>;<instance>;<chef 1|0>;<difficulté du jeu>
A;<Prénom-Royaume>;<vu la 1re fois unix>;<vu la dernière fois unix>;<nombre de relevés>
L;<objet>;<reçu par Prénom-Royaume>;<heure unix>;<boss>;<méthode>;<réponse>;<détail>;<nom de l'objet>
E;<rencontre>;<nom du boss>;<heure de fin unix>;<1 vaincu | 0 échec>
END;<nombre de lignes A, L et E>
```

- `A` : présence, un relevé par minute (comme FRB).
- `L` : objet vu dans le chat (« … reçoit le butin », `CHAT_MSG_LOOT`, plus secret depuis 12.0.7) à partir de la qualité réglée dans l'addon (épique par défaut) ; nom de l'objet tel que le lien le montre (le site n'a pas la base des objets de Retail). En R3a `méthode`, `réponse` et `détail` sont vides (butin de groupe du jeu). **R3b** : pour un objet distribué par Roster, `reçu par` est le gagnant (pas le chef de butin qui l'a ramassé) ; `méthode` : `council` (conseil), `roll` (jets MS / OS ou jet libre), `ml` (donné directement par le chef de butin, ou gardé : détail « gardé ») ; `réponse` (conseil) : `bis`, `upgrade`, `off`, `transmo` ; `détail` comme Forever (le compte des objets reçus en dépend) : « 3 votes » (conseil), « MS 87 », « OS 54 », « jet 54 » (jet libre), « gardé » ; un jet OS ou libre, une réponse Off-spec ou Transmo et un objet gardé ne comptent pas dans « Reçus ». Un objet ramassé par le chef de butin et pas encore distribué reste à son nom, sans méthode.
- `E` : chaque fin de rencontre (`ENCOUNTER_END`) : identifiant de la rencontre, nom du boss, heure, vaincu ou non.
- `chef` : 1 si celui qui a relevé menait le raid au moins la moitié des relevés, **ou** s'il a distribué du butin avec Roster (R3b, comme le bilan du maître du butin sur Forever Roster). Les autres relevés apprennent les gagnants par `LW` : le bilan du chef de raid les a aussi.
- `difficulté du jeu` : `normal`, `heroic`, `mythic` (d'après l'instance), vide si inconnue.

## Messages entre addons Roster

Préfixe `RosterRT`, champs séparés par `;`, canal du raid (ou du groupe ; `INSTANCE_CHAT` pour un groupe formé par la recherche de groupe). Pendant une rencontre de boss, le jeu bloque les messages d'addon (`SendAddonMessage` renvoie `AddOnMessageLockdown`, 12.0) : ils attendent dans une file et partent à la fin du combat, quand le jeu lève la restriction (`ADDON_RESTRICTION_STATE_CHANGED`), ou au nouvel essai suivant, au rythme permis (10 messages d'affilée par préfixe, puis 1 par seconde).

| Message | Sens | Contenu |
|---|---|---|
| `VQ` / `VR;<version>` | tous | Qui a l'addon : question à l'arrivée dans un raid (ou « Redemander »), chacun répond avec sa version. Ceux qui ne répondent pas sont signalés au chef de raid, qui peut leur chuchoter d'un clic d'installer l'addon Roster (le nom seulement, sans lien). |
| `ML;<1 \| 0>;<chef de butin Prénom-Royaume>` | chef de raid ou chef de butin → raid | R3b : distribution par Roster activée (1) ou non (0), et qui est le chef de butin. Envoyé quand ça change, quand quelqu'un rejoint le raid (au plus toutes les 10 s) et en réponse à `MQ`. |
| `MQ` | joueur → raid | R3b : demande l'état de la distribution (arrivée dans le raid, `/reload`). |
| `LR;<objet>` | chef de butin → raid | R3b : le chef de butin a un jet du butin de groupe pour cet objet (`START_LOOT_ROLL`) et l'a pris (Besoin, sinon Transmo, sinon Cupidité) : les addons des autres passent cet objet. |
| `LO;<session>;<item:…>;<nom>` | chef de butin → raid | R3b : objet proposé au conseil (lien d'objet sans couleurs, avec ses bonus : niveau d'objet juste) : fenêtre de réponse chez chacun. Le nom (affiché tant que le jeu ne connaît pas l'objet) est coupé pour que le message tienne en 250 octets. |
| `LA;<session>;<réponse>;<objets portés>;<note>[;<joueur>]` | joueur → chef de butin et conseil (chuchoté) | R3b : `bis`, `upgrade`, `off`, `transmo` ou `pass` ; objets portés sur cet emplacement `objet:niveau` (deux au plus, séparés par des virgules) ; note libre (60 caractères). Sans l'addon : chuchoter « bis », « up », « os », « transmo » ou « passe » au chef de butin, qui relaie la réponse au conseil avec un 6e champ, le joueur `Prénom-Royaume` (accepté seulement du chef de butin). |
| `LV;<session>;<candidat>` | conseil → conseil et chef de butin (chuchoté) | R3b : vote (vide : vote retiré). |
| `LC;<session>;<gagnant>` | chef de butin → raid | R3b : conseil terminé, les fenêtres de réponse se ferment. |
| `LW;<clé>;<objet>;<gagnant>;<méthode>;<réponse>;<détail>` | chef de butin → raid | R3b : objet attribué (clé : l'objet chez le chef de butin ; méthode, réponse et détail comme la ligne `L` du RRB). Les autres addons qui relèvent le raid notent le gagnant dans leur bilan : le bilan du chef de raid et celui du chef de butin concordent. |
| `RS;<objet>;<msos \| free>` | chef de butin → raid | R3b : jets ouverts pour cet objet (MS : `/roll 100`, OS : `/roll 99` ; libre : `/roll 100`) ; les jets sont lus dans le chat (`RANDOM_ROLL_RESULT`), le premier de chacun compte, égalité : seuls les ex æquo relancent, sur « Relancer » du chef de butin (annoncé dans le raid, pas de nouveau `RS`). |

**Distribution par Roster (R3b), comme RCLootCouncil.** Le chef de butin est le chef de raid, sauf s'il en désigne un autre (onglet En raid). Il active « Distribution par Roster » pour le raid (activée d'office quand le raid chargé est en mode `council` sur le site). Alors, à chaque jet du butin de groupe, l'addon de chacun attend le `LR` du chef de butin pour cet objet (20 s au plus) puis passe (`RollOnLoot`, passer) ; sans `LR` (chef de butin pas éligible à ce butin…), il ne passe pas et le dit au joueur. Chacun peut couper le passer automatique pour lui (Options, `RosterDB.autoPass = false`). Le chef de butin reçoit les objets, décide entre les pulls (conseil, jets MS / OS, jet libre, garder), puis échange l'objet au gagnant tant que le jeu le permet (2 h, joueurs présents au moment du butin ; minuteur lu dans l'infobulle de l'objet). À chaque attribution (un clic), l'addon l'annonce dans le canal du raid (« Brumelune reçoit [Objet] (conseil : BiS) ») **et** le chuchote au gagnant (« Tu reçois [Objet] : passe me voir pour l'échange »), choix de Flo. Les joueurs sans l'addon qui gagnent un objet au butin de groupe (ils n'ont pas passé) sont signalés au chef de butin, qui peut leur chuchoter de garder l'objet pour l'échange.

Sur le site (lot R3a) : « Copier pour le jeu » donne RRG sur Roster (FRG sur Forever Roster ; `GET /api/sync/frg` suit la même règle), l'onglet Compo d'un raid de Roster donne RRR et des macros `/inv Prénom-Royaume`, et le Ctrl+V de Roster n'accepte que des bilans RRB (rencontres gardées dans `raid_logs.encounters`, difficulté dans `raid_logs.difficulty`, migration 0031). Un texte d'un addon collé sur le site de l'autre jeu est refusé avec l'adresse à utiliser. Roster Companion ne gère pas encore Roster.
