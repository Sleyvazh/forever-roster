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
X;<sortie>;<heure>;<donjon>;<titre>;<niv min>;<niv max>;<créateur>;<places>;<tanks>;<heals>;<dps>;<attente>;<note>
M;<persos du groupe>
Z;<keyId>;<signature base64>
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
| `X` | Sortie donjon (addon 1.6.1) : une ligne par sortie **du jour ou de demain** (heure de Paris), non annulée, dont l'heure n'est pas passée depuis plus de 2 h ; une sortie « dès que complet » (heure `0`) reste jusqu'à la fin de son jour. Identifiant de la sortie (même forme que celui d'un raid), heure en secondes Unix (`0` : dès que complet), clé du donjon (`FOREVER_DUNGEONS` de game-data, ou `other` pour « Autre (quête de groupe, élite…) »), nom anglais du donjon ou titre libre, fourchette de niveaux (vide pour `other`), prénom du perso du créateur, places `T/H/D` (ex. `1/1/3`, 5 en tout), inscrits de chaque rôle (prénoms séparés par `,`, dans l'ordre d'arrivée ; un inscrit Discord sans compte s'écrit `@<pseudo>`, sans espace), liste d'attente dans l'ordre (`rôle:prénom`, ex. `Heal:Kaelys,DPS:@vex`), note (80 caractères au plus). Rien de personnel : l'addon reconnaît ses persos dans les listes. Ligne signée comme le reste. |

Les lignes `S`, `O`, `C`, `F`, `T`, `L`, `I`, `N` et `X` viennent après les autres (dans cet ordre) et **ne sont pas comptées par `END`** : un addon plus ancien les ignore sans signaler de texte incomplet. `M` (persos du groupe) et `Z` (signature du site) ferment le bloc, juste avant `END`, hors du compte aussi : voir « Partage entre joueurs (signature du site) ». Avec la soft reserve cachée, un membre ne reçoit que ses propres réservations (les officiers les reçoivent toutes) : ce bloc n'est pas signé, il ne se partage pas entre joueurs. L'addon garde le texte de chaque bloc signé (de l'en-tête à `END`) pour le partager ; `M` peut lister plus de 40 persos.

L'addon s'en sert pour :

- **s'inscrire en jeu** : statut choisi par perso, envoyé au site par la ligne `S` du prochain `/fr export` ;
- **les infobulles** : « Recherché par / Connu par » sur l'objet patron, partout (sacs, butin, hôtel des ventes, lien dans le chat) ;
- **les sacs** : liste des patrons suivis présents, avec un bouton **Annoncer** ;
- **le butin** : quand on ramasse un patron suivi ou un BiS recherché, une fenêtre indique qui le recherche, avec **Annoncer au groupe** (message dans le raid ou le groupe, avec le lien de l'objet) ;
- **les sorties donjon** (lignes `X`) : sorties du jour et de demain ; l'inscription se fait sur le site ou sur Discord (pas en jeu en v1).

Exemple de lignes `X` (le même texte sert aux tests du site, `packages/game-data/src/outings.test.ts`, et de l'addon) :

```
X;0f6c1d2e-0000-4000-8000-000000000001;1792105200;gnomeregan;Gnomeregan;29;38;Pikou;1/1/3;Bramm;Kaelys;Pikou,Tiblou,@mirka;Heal:Brindille;Toutes les quêtes : prenez-les avant d'entrer.
X;0f6c1d2e-0000-4000-8000-000000000002;0;other;Élite de la Vallée;;;Torvin;1/1/3;Torvin;;;;
```

**Ce que l'addon fait des lignes `X` (sorties donjon, addon 1.6.1).** L'addon lit chaque ligne `X` d'un bloc (avant `END` seulement ; hors du compte de `END`, un addon plus ancien l'ignore). Elle fait partie du texte signé, sans champ personnel : un bloc reçu d'un autre joueur apporte les mêmes sorties. Rien n'est envoyé au site ni aux autres joueurs, et il n'y a pas d'inscription en jeu en v1 (site ou Discord) :

- **onglet Sorties** (`/fr sorties`) : sorties du jour et de demain des groupes chargés (heure locale du jeu), « dès que complet » en tête du jour, puis par heure ; places par rôle (« libre » pour une place vide), inscrits, liste d'attente, note, créateur. Une sortie passée depuis plus de 2 h disparaît ; une sortie « dès que complet » reste jusqu'à la fin du lendemain du jour où le bloc a été généré. Mes persos (celui connecté et ceux du compte déjà vus par l'addon) sont reconnus par leur prénom : « ta sortie », « tu viens en DPS », « tu es en attente ». Sans sortie : « Crée-en une ou inscris-toi sur le site ou sur Discord. » ;
- **bandeau**, une fois par sortie (fermé : plus jamais pour elle), 15 min avant l'heure et jusqu'à 1 h après, ou dès qu'elle est complète pour « dès que complet » ; jamais en combat ni pendant une rencontre (caché, il revient après). Chez le **créateur** (un de mes persos) : « Gnomeregan à 21:00, complet », les inscrits (en ligne ou non, d'après la liste de guilde du jeu ; déjà dans mon groupe) et **Inviter les N** : `C_PartyInfo.InviteUnit` pour les inscrits qui sont des persos, pas déjà dans le groupe ni hors ligne, hors combat, seul ou chef du groupe, 5 au plus (pas de passage en raid) ; un `@pseudo` est donné « à inviter à la main ». Le même bouton est dans l'onglet, le jour même. Chez un **inscrit** : **Chuchoter <créateur>** ouvre la saisie d'un chuchotement au créateur, vide (rien n'est envoyé tout seul).



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


# FRL, version 1 : relève de la guilde (jeu → site), en essai

**En essai (addon 1.6.0) : pas encore lu par le site.** L'addon relève sa guilde en silence et garde le relevé dans sa sauvegarde. Il ne l'envoie à personne : ni aux autres joueurs, ni dans la boîte d'envoi de Roster Companion (`outbox`, inchangée : l'appli ne voit que les blocs `frc` et `frb`). `/fr guilde` montre ce qui a été relevé et donne ce texte (« Copier le relevé »), pour l'essayer sur la bêta. Le site le lira dans un lot suivant (cahier des charges « Forever pour toute la guilde », §5 et §6).

Ce que l'addon relève (`addon/ForeverRoster/Guild.lua`, API de Retail 12.1.5 : chaque fonction peut manquer sur le client de Forever, chaque valeur secrète est laissée vide) :

- **Liste de guilde** : `C_GuildInfo.GuildRoster()` 15 s après la connexion, puis au plus toutes les 10 min (et à l'ouverture de `/fr guilde` s'il est temps), lue à `GUILD_ROSTER_UPDATE` (`GetGuildRosterInfo`, `GetGuildRosterLastOnline`, `GetGuildInfo("player")`). Notes d'officier seulement si `C_GuildInfo.CanViewOfficerNote()`.
- **Journal de guilde** : `QueryGuildEventLog()` au même rythme, lu à `GUILD_EVENT_LOG_UPDATE` (`GetGuildEventInfo`).
- **Banque de guilde** : seulement pendant qu'elle est ouverte (`PLAYER_INTERACTION_MANAGER_FRAME_SHOW` avec `Enum.PlayerInteractionType.GuildBanker`, ou `GUILDBANKFRAME_OPENED` sur un client qui le connaît). Chaque onglet visible est demandé à son tour (`QueryGuildBankTab`, lu à `GUILDBANKBAGSLOTS_CHANGED`, sinon tel quel au bout de 3 s), puis son journal et celui de l'or (`QueryGuildBankLog`, lu à `GUILDBANKLOG_UPDATE`). Un dépôt ou un retrait fait banque ouverte est relu ; rien n'est relu une fois la banque fermée. Seul le dernier relevé est gardé.
- **Niveau et XP** du perso connecté (`UnitLevel`, `UnitXP`, `UnitXPMax` à `PLAYER_XP_UPDATE`, au plus une fois par minute) et heure exacte de chaque montée de niveau (`time()` à `PLAYER_LEVEL_UP`), pour chaque perso du compte.
- Jamais en combat ni pendant une rencontre (`ENCOUNTER_START` à `ENCOUNTER_END`) : remis à la fin.

```
FRL;1;<guilde>;<faction>;<liste relevée le unix>;<relevée par>;<notes d'officier 1|0>;<mon rang>;<membres>;<royaume>;<version de l'addon>
M;<nom>;<CLASSE>;<niveau>;<rang>;<n° du rang>;<en ligne 1|0>;<hors ligne depuis (heures)>;<note publique>;<note d'officier>;<guid>
J;<journal relevé le unix>;<relevé par>
E;<type>;<joueur 1>;<joueur 2>;<n° du rang>;<il y a (heures)>
B;<banque relevée le unix>;<relevée par>;<or (cuivre)>;<nombre d'onglets>
T;<onglet>;<nom>;<visible 1|0>;<lu 1|0>
I;<onglet>;<case>;<objet>;<quantité>
X;<onglet>;<type>;<qui>;<objet>;<quantité>;<onglet de départ>;<onglet d'arrivée>;<il y a (heures)>
O;<type>;<qui>;<montant (cuivre)>;<il y a (heures)>
P;<perso>;<niveau>;<XP>;<XP du niveau>;<relevée le unix>
U;<perso>;<niveau>;<atteint le unix>
END;<nombre de lignes entre l'en-tête et END>
```

| Ligne | Contenu |
|---|---|
| en-tête | Guilde : nom (`GetGuildInfo`), faction (`Horde`, `Alliance`) et royaume (`GetRealmName`) ; sur Forever, une guilde correspond à un couple règles + faction. `membres` : nombre donné par le jeu (`GetNumGuildMembers`), à comparer au nombre de lignes `M`. Sans liste relevée : `0` et champs vides. |
| `M` | Un membre, triés par nom. **Nom tel que le jeu le renvoie** : « Prénom », « Prénom Nom » (nom de famille de Forever) ou « Prénom-Royaume », à vérifier sur la bêta. La clé d'un membre est son prénom (avant le premier espace ou tiret), en minuscules. Rang : nom et numéro (0 : maître de guilde). Hors ligne depuis : en heures (années, mois de 30 jours, jours et heures donnés par le jeu), `0` en ligne, vide si inconnu. Note d'officier vide si l'en-tête dit `0`. |
| `J`, `E` | Journal de guilde, les plus récents d'abord (100 au plus). `type` du jeu : `invite`, `join`, `promote`, `demote`, `remove`, `quit` ; `n° du rang` : le nouveau rang (promotion, rétrogradation). Date approximative : relevé moins « il y a ». |
| `B`, `T` | Dernier relevé de la banque. Onglet que le rang du joueur ne voit pas : `0;0`, jamais demandé ; onglet visible pas encore lu (banque fermée trop tôt) : `1;0`. |
| `I` | Objets des onglets lus, une ligne par case occupée (1 à 98). Les mascottes de combat (lien sans `item:`) ne sont pas relevées. |
| `X`, `O` | Journaux des onglets visibles et de l'or, 50 lignes chacun au plus, les plus récents d'abord. `type` du jeu : `deposit`, `withdraw`, `move`, `repair`… ; onglets de départ et d'arrivée pour `move`. |
| `P`, `U` | Persos du compte relevés dans cette guilde (prénom) : dernière XP lue ; heure exacte de chaque niveau atteint depuis l'addon 1.6.0. |

- Toutes les lignes comptent dans `END`. Chaque partie est facultative : sans journal, sans banque ou sans XP, leurs lignes manquent.
- Échappement comme les autres formats : `;`, `|` et retours à la ligne remplacés par une espace (`F.clean`). Valeur secrète ou illisible : champ vide.
- Forme stable (empreinte, pour décider plus tard d'un nouvel envoi ; pas encore utilisée) : mêmes lignes, avec les champs qui bougent tout seuls vidés (heures de relève, qui a relevé, mon rang, version de l'addon, en ligne, « il y a » des journaux), la dernière connexion en jours (`(relevé − heures × 3600) / 86400`, arrondi en dessous) et l'XP en dixièmes de niveau.
- Sauvegarde : `ForeverRosterDB.guilds["<guilde>-<royaume>-<faction>"]` (`roster`, `events`, `bank`) et, pour chaque perso, `ForeverRosterDB.chars[…].guild`, `.xp`, `.levels`. Une fiche de guilde qu'aucun perso du compte n'a plus est retirée à la connexion.
- Générateur : `F.BuildFRL` (`addon/ForeverRoster/Format.lua`), testé dans `addon/tests/format_test.lua` ; relève simulée dans `addon/tests/wow_sim.lua` (section 8 quinquies), dont la sauvegarde est relue par Roster Companion (test `roundtrip.rs`).
- À régler avant un envoi par Roster Companion : un bloc y est limité à 64 Kio (`MAX_TEXT` dans `outbox.rs`), une guilde de plus de 500 membres environ le dépasserait.


# Messages entre addons (lot G, addon 1.0)

Préfixe `FRoster`, champs séparés par « ; », canal du raid (ou du groupe) sauf mention. Rien ne passe par le site.

| Message | Sens | Contenu |
|---|---|---|
| `VQ` / `VR;<version>` | tous | Qui a l'addon : question à l'arrivée dans un raid (ou « Redemander »), chacun répond avec sa version. |
| `CQ;<objets>` | chef → raid | Appel aux consommables ; chacun répond en privé `CR;<objet>:<quantité>,…` (sacs et banque). Clos après 8 s ; résultat gardé avec le bilan (`Q`, `K`). |
| `LO;<session>;<objet>;<nom>` | maître du butin → raid | Objet proposé au conseil : fenêtre de réponse chez chacun. Le nom (1.2, ignoré avant) s'affiche tant que le jeu ne connaît pas encore l'objet. |
| `LA;<session>;<réponse>;<objets portés>;<note>` | joueur → conseil (privé) | Réponse : `bis`, `upgrade`, `off`, `transmo` ou `pass`. Sans addon : chuchoter « bis », « up », « os » ou « transmo » au maître du butin (aussi en anglais : upgrade, off, offspec, transmog, tmog, pass). |
| `LV;<session>;<candidat>` | conseil → conseil (privé) | Vote (vide : vote retiré). |
| `LC;<session>;<gagnant>` | maître du butin → raid | Conseil terminé : les fenêtres de réponse se ferment. |
| `SHV`, `SHQ`, `SHD` | guilde, raid, chuchoté | Partage des données du site entre joueurs (1.6) : voir « Partage entre joueurs (signature du site) ». |

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

- `frg` remplace les groupes chargés, sans message, s'il est plus récent que le dernier chargement (un collage manuel plus récent est gardé) ; groupe par groupe depuis l'addon 1.5.9 : un groupe dont l'addon a déjà une version aussi récente (reçue d'un joueur par le partage) reste, un groupe absent de `frg` disparaît.
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

**Retours du raid de test (addon 0.3, 09/10)** : détail des objets reçus, juste après `N`, hors du compte de `END` (un addon 0.2 l'ignore) :

```
D;<perso>+<perso>:<BiS>:<Upgrade>:<jets MS>,…
```

- `D` : mêmes entrées que `N`, dans le même ordre et avec les mêmes noms, sur la même période. Trois nombres (choix de Flo, « BiS · Upgrade · Jets MS ») : conseil `bis` ; conseil `upgrade` (et le « Spé 1 » d'un historique importé) ; jet dont le détail commence par `MS`. Les autres objets qui comptent (donné directement par le chef de butin, objet seulement noté, conseil sans réponse, correction sans catégorie) sont dans le total `N` seulement : total ≥ BiS + Upgrade + MS. Un objet qui ne compte pas (`lootSkipReason`) ou qu'un officier exclut n'est dans aucun nombre. Le site omet les entrées à 0:0:0, et la ligne `D` entière quand toutes le sont : une entrée de `N` absente de `D` vaut 0:0:0.
- Corrections du compte (lot I) : une correction peut avoir une catégorie (`bis`, `upgrade`, `ms`, ou aucune ; `kind` de `POST /api/groups/:id/loot-corrections`, colonne `loot_corrections.kind`, migration 0033) ; l'import d'un historique crée une correction BiS (« Historique Season 2 : 3 BiS ») et une correction Upgrade (« Historique Season 2 : 4 Spé 1 ») par joueur, aucune pour une catégorie à 0.
- Exemple (`addon/tests/sample.rrg`) : `N;saison;depuis le 05/10/2026;Kaeldra-Hyjal+Vex-Kael'Thas:3,Tharok-ConseildesOmbres:2,Brumelune-Ysondre:0` puis `D;Kaeldra-Hyjal+Vex-Kael'Thas:1:1:1,Tharok-ConseildesOmbres:1:0:0` (Tharok a aussi un objet sans catégorie ; Brumelune, à 0:0:0, n'est pas dans `D`).

Ordre : `O`, puis un `L` par raid (dans l'ordre des `R`), puis `N`, puis `D`, puis `M` et `Z` (partage entre joueurs, voir « Partage entre joueurs (signature du site) »). Lignes vides omises (pas de `O` sans officier, pas de `L` si aucun membre du conseil choisi n'a de perso dans le groupe : l'addon prend alors `O`).

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
- `L` : objet vu dans le chat (« … reçoit le butin », `CHAT_MSG_LOOT`, plus secret depuis 12.0.7) à partir de la qualité réglée dans l'addon (épique par défaut), équipement seulement depuis 0.3.1 (armes, armures, jetons : pas les composants comme les Étincelles, ni consommables, gemmes, recettes, montures, mascottes) ; chaque attribution du chef de butin est notée même si le relevé était en pause au moment du clic (/reload…), et rattrapée avant l'export ; nom de l'objet tel que le lien le montre (le site n'a pas la base des objets de Retail). En R3a `méthode`, `réponse` et `détail` sont vides (butin de groupe du jeu). **R3b** : pour un objet distribué par Roster, `reçu par` est le gagnant (pas le chef de butin qui l'a ramassé) ; `méthode` : `council` (conseil), `roll` (jets MS / OS ou jet libre), `ml` (donné directement par le chef de butin, ou gardé : détail « gardé ») ; `réponse` (conseil) : `bis`, `upgrade`, `off`, `transmo` ; `détail` comme Forever (le compte des objets reçus en dépend) : « 3 votes » (conseil), « MS 87 », « OS 54 », « jet 54 » (jet libre), « gardé » ; un jet OS ou libre, une réponse Off-spec ou Transmo et un objet gardé ne comptent pas dans « Reçus ». Un objet ramassé par le chef de butin et pas encore distribué reste à son nom, sans méthode.
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
| `LA;<session>;<réponse>;<objets portés>;<note>[;<joueur>[;r]][;<total>;<BiS>;<Upgrade>;<jets MS>;<main>]` | joueur → chef de butin et conseil (chuchoté) | R3b : `bis`, `upgrade`, `off`, `transmo` ou `pass` ; objets portés sur cet emplacement `objet:niveau` (deux au plus, séparés par des virgules) ; note libre (60 caractères). Le conseil connu du joueur vient des données du site : sans elles, la réponse ne part qu'au chef de butin. Relais du chef de butin (6e champ : le joueur `Prénom-Royaume`, accepté seulement du chef de butin) : réponse chuchotée par un joueur sans l'addon (« bis », « up », « os », « transmo » ou « passe », et depuis 0.3.2 leurs équivalents anglais : upgrade, off, offspec, off-spec, transmog, tmog, pass ; chuchoté au conseil, note vide) ; depuis 0.2.1, chaque réponse reçue de l'addon d'un joueur est renvoyée **au raid** avec un 7e champ `r` (note et objets portés gardés) : seuls les membres du conseil, qui ont ce conseil, la gardent. **0.4 (R4a)** : champs 8 à 12, les nombres du chef de butin pour ce joueur (voir « Historique durable » ci-dessous). |
| `LV;<session>;<candidat>` | conseil → conseil et chef de butin (chuchoté) | R3b : vote (vide : vote retiré). |
| `LC;<session>;<gagnant>` | chef de butin → raid | R3b : conseil terminé, les fenêtres de réponse se ferment. |
| `LW;<clé>;<objet>;<gagnant>;<méthode>;<réponse>;<détail>[;<id>;<v>;<niveau>]` | chef de butin → raid | R3b : objet attribué (clé : l'objet chez le chef de butin ; méthode, réponse et détail comme la ligne `L` du RRB). Les autres addons qui relèvent le raid notent le gagnant dans leur bilan : le bilan du chef de raid et celui du chef de butin concordent. **0.4 (R4a)** : identifiant et version de l'entrée de l'historique, niveau de l'objet ; chaque addon qui le reçoit crée la même entrée dans son historique. |
| `RS;<objet>;<msos \| free>` | chef de butin → raid | R3b : jets ouverts pour cet objet (MS : `/roll 100`, OS : `/roll 99` ; libre : `/roll 100`) ; les jets sont lus dans le chat (`RANDOM_ROLL_RESULT`), le premier de chacun compte, égalité : seuls les ex æquo relancent, sur « Relancer » du chef de butin (annoncé dans le raid, pas de nouveau `RS`). |

**Retours du raid de test (addon 0.3, 09/10).**
- **Objets portables** : chacun ne peut répondre BiS, Upgrade ou Off-spec qu'à un objet qu'il peut porter ; sinon seulement Transmo (et Passer). Armure (tête, épaules, torse, taille, jambes, pieds, poignets, mains) : le type exact de la classe (tissu : mage, prêtre, démoniste ; cuir : chasseur de démons, druide, moine, voleur ; mailles : évocateur, chasseur, chaman ; plaques : chevalier de la mort, paladin, guerrier). Le reste (armes, boucliers, objets tenus en main gauche, jetons réservés à certaines classes) : d'après l'infobulle du jeu (une ligne en rouge = pas pour toi). Le chef de butin applique la règle de l'armure aux réponses chuchotées (sans l'addon) : BiS, Upgrade ou Off-spec sur une armure d'un autre type devient Transmo.
- **Tout au conseil** : le chef de butin peut proposer d'un coup tous les objets à distribuer (un `LO` par objet). Une seule annonce numérote les objets (« 1 [A], 2 [B]… ») ; sans l'addon, on chuchote la réponse suivie du numéro (« bis 2 ») ; une réponse sans numéro ne vaut que s'il n'y a qu'un conseil ouvert (sinon le chef de butin rappelle la forme en chuchotant). Fenêtres de réponse et du conseil : on passe d'un objet à l'autre (bande d'objets en haut).
- **Échange** : dès qu'une fenêtre d'échange s'ouvre avec un joueur à qui des objets sont attribués (qu'il l'ait ouverte ou que le chef de butin ait cliqué « Échanger »), l'addon du chef de butin y pose ces objets (6 au plus). « Échanger » sans fenêtre au bout de quelques secondes : le message d'erreur du jeu s'il y en a un, sinon la marche à suivre (le gagnant ouvre l'échange, l'objet sera posé tout seul).

**Retours du raid du 11/10/2026 (Roster).** Pas de BiS, Upgrade ni Off-spec sur une arme que la classe ne peut pas équiper (Transmo et Passer seulement) : la règle de l'armure s'étend aux armes (sous-classe d'arme du jeu), aux boucliers et aux objets tenus en main gauche, chez le joueur (avant l'infobulle), chez le chef de butin (réponses chuchotées : devenues Transmo) et au conseil (réponse grisée, « ne peut pas le porter »). Règles de Retail (Midnight 12.x, sources dans `addon/Roster/Loot.lua`) :

| Classe | Armes, bouclier, main gauche |
|---|---|
| Chevalier de la mort | haches, masses et épées (une et deux mains), armes d'hast |
| Chasseur de démons | haches et épées à une main, glaives de guerre, armes de pugilat, dagues (12.1) ; main gauche : sans avis |
| Druide | masses (une et deux mains), armes d'hast, bâtons, armes de pugilat, dagues, main gauche |
| Évocateur | haches, masses et épées (une et deux mains), bâtons, armes de pugilat, dagues, main gauche |
| Chasseur | haches et épées (une et deux mains), armes d'hast, bâtons, armes de pugilat, dagues, arcs, armes à feu, arbalètes |
| Mage, démoniste | épées à une main, bâtons, dagues, baguettes, main gauche |
| Moine | haches, masses et épées à une main, armes d'hast, bâtons, armes de pugilat, main gauche |
| Paladin | haches, masses et épées (une et deux mains), armes d'hast, bouclier, main gauche |
| Prêtre | masses à une main, bâtons, dagues, baguettes, main gauche |
| Voleur | haches, masses et épées à une main, armes de pugilat, dagues ; arcs, armes à feu, arbalètes : sans avis |
| Chaman | haches et masses (une et deux mains), bâtons, armes de pugilat, dagues, bouclier, main gauche |
| Guerrier | haches, masses et épées (une et deux mains), armes d'hast, bâtons, armes de pugilat, dagues, bouclier ; arcs, armes à feu, arbalètes : sans avis |

Tout autre type est refusé ; « sans avis » (pas sûr), cannes à pêche et types disparus : rien n'est refusé (chez le joueur, l'infobulle du jeu décide).

**Distribution par Roster (R3b), comme RCLootCouncil.** Le chef de butin est le chef de raid, sauf s'il en désigne un autre (onglet En raid). Il active « Distribution par Roster » pour le raid (activée d'office quand le raid chargé est en mode `council` sur le site). Alors, à chaque jet du butin de groupe, l'addon de chacun attend le `LR` du chef de butin pour cet objet (20 s au plus) puis passe (`RollOnLoot`, passer) ; sans `LR` (chef de butin pas éligible à ce butin…), il ne passe pas et le dit au joueur. Chacun peut couper le passer automatique pour lui (Options, `RosterDB.autoPass = false`). Le chef de butin reçoit les objets, décide entre les pulls (conseil, jets MS / OS, jet libre, garder), puis échange l'objet au gagnant tant que le jeu le permet (2 h, joueurs présents au moment du butin ; minuteur lu dans l'infobulle de l'objet). À chaque attribution (un clic), l'addon l'annonce dans le canal du raid (« Brumelune reçoit [Objet] (conseil : BiS) ») **et** le chuchote au gagnant (« Tu reçois [Objet] : passe me voir pour l'échange »), choix de Flo. Les joueurs sans l'addon qui gagnent un objet au butin de groupe (ils n'ont pas passé) sont signalés au chef de butin, qui peut leur chuchoter de garder l'objet pour l'échange.

**Historique durable (lot R4a, addon 0.4.0).** Étude « Roster autonome » (§5.2, §5.4, §5.7) : l'addon garde lui-même tout ce que Roster distribue, sans raid du site et sans limite de durée (sauvegarde `RosterDB.hist`, `addon/Roster/History.lua`) ; le site n'est plus indispensable pour les compteurs du conseil.

- **Entrées** : une par objet attribué (conseil, jets, choix du chef de butin), gardé (« gardé », ne compte pas) ou gagné au butin de groupe par un joueur qui n'a pas passé (noté chez le chef de butin, détail « butin de groupe », compte sans catégorie comme un objet seulement noté). Identifiant `<node>-<heure base 36>-<n>` (`node` : 5 caractères base 36 tirés au premier lancement de l'addon, un par installation) ; version `v` (heure du serveur, `GetServerTime`) et auteur `by` ; `seq` : horloge locale, +1 à chaque changement fait ici ou reçu (synchro entre officiers à venir). La version la plus récente gagne (`v`, puis `by`, puis une somme du contenu) : un même LW reçu deux fois ne change rien, une attribution refaite (nouveau gagnant) remplace l'ancienne partout. Une suppression sera une tombe (`del`), jamais un retrait. Catégorie `cat` : `bis`, `up` (Upgrade), `ms` (jet MS), `other` (compte, dans le total seulement), absente : ne compte pas (même règle que `lootSkipReason`).
- **Soirées** : relevées dès que le joueur est dans un groupe de raid, dans une instance de raid (`GetInstanceInfo`), distribution par Roster active, sans raid du site ; une soirée par instance et difficulté, reprise après un `/reload` (moins de 4 h sans relevé) : présence chaque minute (`Prénom-Royaume` → première fois, dernière fois, relevés), boss (`ENCOUNTER_END` : rencontre, nom, heure, vaincu ou non), chef de butin.
- **`LW` (champs 8 à 10)** : `LW;<clé>;<objet>;<gagnant>;<méthode>;<réponse>;<détail>;<id>;<v>;<niveau>`, par exemple `LW;1794513000-242394-3;242394;Brumelune-Ysondre;council;bis;3 votes;k3f9q-tm1a0x-1n;1794520000;639`. Un addon 0.3 ne lit que les 7 premiers champs. Un LW sans identifiant (chef de butin en 0.3) donne l'identifiant `lw-<somme djb2 (modulo 2³², en base 36) de « <nom du chef de butin, en minuscules, sans accents ni apostrophes>;<clé de l'objet> »>`, le même chez tous, et le même que celui que le chef de butin donne à ses attributions d'avant la 0.4 en passant en 0.4.
- **`LA` (champs 8 à 12)** : à chaque réponse qu'il relaie (relais au raid `r`, réponse chuchotée relayée au conseil avec un 7e champ vide, ou sa propre réponse avec les champs 6 et 7 vides), le chef de butin joint ses nombres pour ce joueur : `<total>;<BiS>;<Upgrade>;<jets MS>;<main si alt>` (main : lot R4c, vide pour l'instant), ou `-;;;;` s'il n'a ni données du site ni historique. Exemple : `LA;5128830;bis;242111:636;BiS pour moi;Tharok-Hyjal;r;4;2;1;0;`. Seuls ceux du chef de butin sont pris : le conseil voit **ses** nombres (les mêmes pour tous, sans site ni synchro) ; avec `-`, chacun voit les siens et la fenêtre du conseil le dit (« comptes : aucun historique chez Tharok »). Un addon 0.3 ignore ces champs (le 7e reste `r` ou vide).
- **« Reçus » pendant la transition** : tant que des données du site sont chargées (`N`, `D` du groupe du raid en cours, sinon du seul groupe chargé qui en a), compte = celui du site **plus** les entrées de l'historique postérieures à la date de génération du bloc RRG (`RRG;1;<groupe>;<généré le>`), sans double compte ; sans données du site, l'historique seul. Le butin des alts compte pour la personne (choix de Flo) : les persos d'une même entrée `N` comptent ensemble ; les liens main / alts viendront avec le lot R4c.
- Rien ne change pour le site dans ce lot : le bilan RRB est toujours relevé pendant un raid du site ; l'envoi de l'historique au site (bloc RRH) viendra avec le lot R4f.

Sur le site (lot R3a) : « Copier pour le jeu » donne RRG sur Roster (FRG sur Forever Roster ; `GET /api/sync/frg` suit la même règle), l'onglet Compo d'un raid de Roster donne RRR et des macros `/inv Prénom-Royaume`, et le Ctrl+V de Roster n'accepte que des bilans RRB (rencontres gardées dans `raid_logs.encounters`, difficulté dans `raid_logs.difficulty`, migration 0031). Un texte d'un addon collé sur le site de l'autre jeu est refusé avec l'adresse à utiliser. Roster Companion ne gère pas encore Roster.

## Langue des addons (Forever Roster 1.5.6, Roster 0.3.2)

L'interface suit la langue du client du jeu (`GetLocale()` : `frFR` → français, toute autre → anglais), ou celle choisie dans les options (`lang` = `"fr"` ou `"en"` dans la sauvegarde ; `/fr langue`, `/roster langue`, appliquée au rechargement de l'interface). Mécanisme commun : `addon/shared/Locale.lua` (`ns.L["texte français"]`, `ns.L("format", …)`, `ns.N` pour les tables construites au chargement) ; traductions dans `Locale_en.lua` de chaque addon et `addon/shared/Locale_en_Kit.lua`. **Rien de ce qui est décrit dans ce document ne change avec la langue** : messages entre addons, textes pour le site (FRC, FRB, RRG, RRR, RRB…), détails du bilan (« gardé », « 3 votes », « MS 87 »), sauvegarde. Annonces au raid et chuchotements partent dans la langue de celui qui les envoie ; les réponses chuchotées par les joueurs sans l'addon sont lues dans les deux langues. Vérifications : `lua5.1 addon/tests/locale_check.lua` (chaque texte a sa traduction, aucun texte français oublié hors de `L`) et le contrôle des textes à la fin de `wow_sim.lua`, `roster_sim.lua` et `roster_ui_test.lua` (`addon/tests/locale_audit.lua`).

# Partage entre joueurs (signature du site)

Décidé avec Flo le 12/10. Avant : chaque joueur cliquait « Copier pour le jeu » et collait dans l'addon avant chaque raid. Maintenant **un** joueur colle (ou reçoit par Roster Companion) et l'addon partage les données de chaque groupe avec les joueurs de la guilde connectés et ceux du raid (pour ceux hors de la guilde) qui ont l'addon. Le **site signe** chaque bloc (RSA 2048, PKCS#1 v1.5, SHA-256) ; chaque addon vérifie avec la clé publique compilée dans l'addon. Signé, plus récent que le mien et d'un groupe dont je suis membre : appliqué tout seul, d'où qu'il vienne. Le reste est ignoré, jamais appliqué. Un bloc non signé (ancien site, pas de clé sur le serveur) n'est jamais partagé. Les deux addons (Forever Roster et Roster), mêmes règles.

## Lignes M et Z (RRG et FRG)

```
M;<persos du groupe, séparés par des virgules>
Z;<keyId>;<signature base64>
```

- Après toutes les autres lignes du bloc, **juste avant `END`**, et **pas comptées par `END`** : un ancien addon les ignore.
- `M` : tous les persos rangés dans le groupe sur le site (mains et alts des membres actuels), écrits comme la ligne `O` du format : prénom seul en FRG (`Greta`), `Prénom-Royaume` en RRG (`Tharok-ConseildesOmbres`) ; sans doublon, triés. **Toujours là**, même vide (`M;`) et même sans signature. L'addon qui reçoit le bloc d'un autre joueur ne le garde que si l'un de ses persos y est. `M` fait partie du texte signé.
- `Z` : seulement si le serveur a une clé (`SYNC_SIGNING_KEY`, voir docs/operations.md). Dernière ligne avant `END`.
- Exception : un bloc FRG avec un raid en soft reserve **cachée** n'est pas signé (chacun y reçoit des réservations différentes, qui ne doivent pas passer à d'autres) : ce groupe n'est pas partagé, chacun colle le sien comme avant.
- Exemples signés avec la clé de test : `addon/tests/sample.rrg` (écrit par `packages/game-data/src/roster-addon.test.ts`) et `addon/tests/sample.frg` (deux groupes, écrit par `packages/game-data/src/share.test.ts`) ; déterministes (signature PKCS#1 v1.5).

## Forme canonique (ce qui est signé)

Lignes du bloc de l'en-tête (`RRG;…` ou `FRG;…`) à la dernière avant `Z`, sans `Z` ni `END` :

- chaque ligne sans `\r`, espaces et tabulations retirés au début et à la fin (lignes vides omises) ;
- **champs personnels vidés** dans les lignes `R` (champ 1 = `R`) : champs 7 et 8 en RRG (mon statut, mon perso), 5 et 6 en FRG ; les séparateurs restent (`R;<raid>;<date>;<nom>;;;journal` en FRG). Seuls les champs présents sont vidés (le site écrit toujours tous les champs) ;
- lignes jointes par `\n`, sans `\n` final, en octets UTF-8.

Ainsi le bloc d'un joueur vaut pour tous les membres : deux joueurs du même groupe, au même moment, ont la même forme canonique et la même signature. Un bloc dont les champs personnels sont déjà vides est sa propre forme canonique. Code : `canonicalGroupBlock(text, kind)` et `splitGroupBlocks(text, kind)` dans `packages/game-data/src/share.ts` (partagés par l'API et les tests).

## Signature et keyId

- Signature : RSASSA-PKCS1-v1_5 avec SHA-256 sur les octets de la forme canonique, en base64 standard avec `=` (344 caractères pour une clé de 2048 bits).
- `keyId` : 8 premiers caractères hexadécimaux (minuscules) du SHA-256 du module RSA (octets big-endian, sans zéro de tête).
- Clé de **test** (tests seulement, jamais dans un zip) : `addon/tests/fixtures/site-test-key.pem` (privée, PKCS#8), `site-test-key.pub.pem`, `SiteKeyTest.lua` ; keyId `a3de5db8`. Les tests de l'API et les tests de bout en bout (`e2e/start.mjs`) signent avec elle.
- Clés publiques dans les addons : `addon/shared/SiteKey.lua` (chargé par les deux `.toc`, avant `Share.lua`) : `ns.SITE_KEYS["<keyId>"] = { n = "<module hexadécimal>", e = 65537 }`, écrit par `node scripts/site-key.mjs <clé publique.pem> --write` (plusieurs clés possibles lors d'un changement de clé). Vide tant que la clé de production n'y est pas : l'addon n'annonce rien et n'accepte rien.
- `GET /api/sync/key` (sans connexion) : `{ keyId, publicKey }` (PEM de la clé publique) ; 404 si le serveur n'a pas de clé.
- `GET /api/sync/frg` (Roster Companion) : blocs signés comme « Copier pour le jeu » ; l'`ETag` ignore la date de génération et la signature (qui change avec elle) mais garde le keyId.

## Messages entre addons (SHV, SHQ, SHD)

Préfixe de chaque addon (`RosterRT` pour Roster, `FRoster` pour Forever Roster) et sa file d'envoi ; chaque message ≤ 255 octets.

| Message | Sens | Contenu |
|---|---|---|
| `SHV;<kind>;<groupe>;<at>;<len>` | annonce, GUILD ou RAID | « J'ai le groupe `<groupe>` généré à `<at>` » (`kind` : `RRG` ou `FRG` ; `len` : taille en octets). Seulement pour un bloc **signé**. Envoyé sur GUILD 20 à 40 s (au hasard) après la connexion et juste après un collage ou de nouvelles données ; sur RAID en rejoignant ou en formant un raid. |
| `SHQ;<groupe>;<at>` | chuchoté à celui qui annonce | « Envoie, j'ai `<at>` » (0 : rien). Seulement si le `<at>` annoncé est plus récent que le mien ; sans données pour ce groupe, une fois par groupe et par session au plus. |
| `SHD;<groupe>;<at>;<i>;<n>;<morceau>` | diffusé sur le canal de l'annonce | Morceau `i` sur `n` du texte partagé (forme canonique, puis la ligne `Z`, puis `END`). Une seule diffusion, sur le canal où l'`SHV` demandé a été annoncé, après 0,5 à 3 s au hasard, annulée si quelqu'un d'autre diffuse déjà cette version ou une plus récente ; une diffusion d'une même version par canal et par 60 s au plus. |

À la réception : morceaux réassemblés (abandon après 120 s), signature vérifiée (`keyId` connu de `ns.SITE_KEYS`, signature valable sur la forme canonique), `at` plus récent que le mien, et l'un de mes persos dans `M` ; alors l'addon applique les données en gardant **mes** champs personnels (mon statut et mon perso pour chaque raid, d'après mes données précédentes). Les données appliquées restent signées et peuvent être relayées à leur tour.

Option de chaque addon (onglet Options) : « Partager les données du site avec la guilde et le raid », activée d'office ; désactivée, l'addon n'annonce et n'envoie plus rien (il reçoit toujours). L'onglet Synchro indique, pour chaque groupe, d'où viennent les données (« collées », « reçues de X ») et quand.

### Forever Roster

Branchement : fin de `Group.lua` (adaptateur de `Share.lua`) et `Raid.lua` (préfixe `FRoster`, réception des `SHV`, `SHQ`, `SHD`, file de fond).

- **Noms** : prénoms seuls, comme le reste de l'addon (royaume et nom de famille de Forever retirés, casse ignorée). L'expéditeur est le prénom donné par `CHAT_MSG_ADDON` (`SHQ` chuchoté à ce prénom) ; l'écho de mes propres messages (guilde, raid) est ignoré. Mes persos, pour la ligne `M` : celui connecté, ceux du compte déjà vus par l'addon (`ForeverRosterDB.chars`) et ceux de mes inscriptions (champ 6 des lignes `R` de mes données).
- **Champs personnels** : un bloc reçu remplace le groupe (les autres groupes restent), avec mon statut et mon perso (champs 5 et 6 des lignes `R`) repris de mes données précédentes pour chaque raid ; un raid nouveau pour moi est « inscription inconnue » (`unknown`). Le groupe retient la date de mes dernières données à moi (`mineAt`) : `G.Reconcile` compare l'accusé de réception d'une inscription faite en jeu à cette date, pas à celle du bloc reçu, et ne se prononce pas sur un raid inconnu. Les inscriptions en attente (lignes `S` du FRC) partent donc comme avant.
- **Sources** : collage (synchro, synchro rapide) et Roster Companion (`frg` de `ForeverRoster_Data`, blocs signés aussi) ; `G.Load(text, replace, quiet, how)` garde son sens (plusieurs groupes : ils remplacent les autres ; un seul : ajouté ou mis à jour ; `how = "companion"` pour l'origine affichée). Annonce à la guilde 20 à 40 s après la connexion (les données de Roster Companion lues à la connexion partent avec elle), à la guilde et au raid 1 à 3 s après un collage ou une actualisation de Roster Companion qui apporte du nouveau, au raid 3 à 8 s après l'arrivée dans un raid ou quand il s'agrandit ; un bloc reçu est relayé sur l'autre canal 2 à 6 s après.
- **File de fond** : les messages du partage ne partent jamais tout de suite. Le jeu limite les messages d'addon (10 d'affilée par préfixe, puis 1 par seconde) ; l'addon compte aussi ses messages du raid (envoyés tout de suite) et la file laisse toujours 6 messages libres pour eux. Rien en combat (`InCombatLockdown`, joueur en combat), attente si le jeu répond `AddOnMessageLockdown` ou une limite atteinte ; un message attend 10 minutes au plus.
- **Option** : `ForeverRosterDB.share = false` (onglet Options). **Onglet Synchro** : « collées le … », « chargées par Roster Companion le … » ou « reçues de X le … » pour chaque groupe (3 lignes au plus), avec « non partagées : pas signées par le site » (soft reserve cachée, ancien site) ou « clé du site inconnue ».
