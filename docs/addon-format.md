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
| `S` | Inscription faite en jeu (onglet Raids) : identifiant du groupe, du raid, statut (`present`, `late`, `tentative`, `absent`). Le site l'enregistre pour ce perso ; une ligne par raid, la dernière l'emporte. |
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

Les lignes `S`, `O`, `C`, `F`, `T`, `L` et `I` viennent après les autres et **ne sont pas comptées par `END`** : un addon plus ancien les ignore sans signaler de texte incomplet. Avec la soft reserve cachée, un membre ne reçoit que ses propres réservations (les officiers les reçoivent toutes).

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

Méthode : `council`, `sr`, `roll`, `ml` (maître du butin) ou vide ; réponse au conseil : `bis`, `upgrade`, `off`, `transmo` ou vide ; détail libre (« 3 votes », « jet 87 + 10 »). Le site lit les versions 1 et 2. Chaque bilan alimente aussi le **catalogue de butin** (objet, boss, instance ; aucune donnée de joueur), qui sert à proposer les objets d'un raid en soft reserve : les tables de butin ne sont pas dans les fichiers du jeu.

Sur le site (Ctrl+V n'importe où), le bilan est enregistré sur le raid (un nouveau collage le remplace), seulement par un officier du groupe ou le créateur du raid. Les prénoms sont rapprochés des fiches des membres. Statuts : présent ; en retard (arrivé plus de 10 min après l'heure prévue) ; parti tôt (absent du dernier quart de la soirée, au moins 15 min) ; banc (inscription « banc ») ; inscrit, absent (inscrit présent ou en retard, jamais vu). Un objet reçu qui est l'objectif BiS d'une fiche y est coché « obtenu ».


# Messages entre addons (lot G, addon 1.0)

Préfixe `FRoster`, champs séparés par « ; », canal du raid (ou du groupe) sauf mention. Rien ne passe par le site.

| Message | Sens | Contenu |
|---|---|---|
| `VQ` / `VR;<version>` | tous | Qui a l'addon : question à l'arrivée dans un raid (ou « Redemander »), chacun répond avec sa version. |
| `CQ;<objets>` | chef → raid | Appel aux consommables ; chacun répond en privé `CR;<objet>:<quantité>,…` (sacs et banque). Clos après 8 s ; résultat gardé avec le bilan (`Q`, `K`). |
| `LO;<session>;<objet>` | maître du butin → raid | Objet proposé au conseil : fenêtre de réponse chez chacun. |
| `LA;<session>;<réponse>;<objets portés>;<note>` | joueur → conseil (privé) | Réponse : `bis`, `upgrade`, `off`, `transmo` ou `pass`. Sans addon : chuchoter « bis », « up », « os » ou « transmo » au maître du butin. |
| `LV;<session>;<candidat>` | conseil → conseil (privé) | Vote (vide : vote retiré). |
| `LC;<session>;<gagnant>` | maître du butin → raid | Conseil terminé : les fenêtres de réponse se ferment. |

Les jets (soft reserve, MS / OS, jet libre) passent par `/roll` : l'addon du maître du butin lit le message du jeu (`RANDOM_ROLL_RESULT`, dans la langue du client), ne compte que le premier jet de chacun et le bon dé (100, ou 99 en OS), ajoute le bonus SR+ ; en cas d'égalité, seuls les ex æquo relancent.
