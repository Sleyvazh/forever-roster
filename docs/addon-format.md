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

# FRC, version 1 : un perso, du jeu vers le site

```
FRC;1;<nom>;<royaume>;<CLASSE>;<race>;<niveau>;<faction>;<date unix>;<version de l'addon>
G;<emplacement>;<objet>
P;<métier ou compétence>;<rang>;<rang max>
R;<métier>;s<sort> | i<objet>
T;<nœud>;<rang>;<rang max>;<x>;<y>;<sort>;<sous-arbre>;<arbre>
END;<nombre de lignes entre l'en-tête et END>
```

| Ligne | Contenu |
|---|---|
| en-tête | `CLASSE` : jeton du jeu (`DRUID`…). `race` : jeton du jeu (`Tauren`, `Scourge` pour Undead, `NightElf`…). |
| `G` | Objet porté : emplacement du jeu (1 tête, 2 cou, 3 épaules, 15 dos, 5 torse, 9 poignets, 10 mains, 6 taille, 7 jambes, 8 pieds, 11-12 doigts, 13-14 bijoux, 16 main droite, 17 main gauche, 18 distance), identifiant de l'objet. Chemise et tabard ne sont pas exportés. |
| `P` | Toutes les compétences du perso, nom tel qu'affiché par le jeu. Le site reconnaît les métiers en anglais et en français et ignore le reste (armes, langues…). |
| `R` | Patron connu, relevé à l'ouverture des fenêtres de métier : `s` + sort de fabrication, ou `i` + objet fabriqué quand le jeu ne donne que lui. |
| `T` | Talent (système de talents de Forever, `C_Traits`) : identifiant du nœud, rang, rang max, position dans l'arbre, sort, sous-arbre et arbre. |

Le générateur est `Format.lua` (`BuildFRC`), le lecteur `parseCharacterExport` dans `packages/game-data/src/charexport.ts`. Le test Lua (`addon/tests/format_test.lua`) écrit `addon/tests/sample.frc`, que le test du site relit : les deux côtés sont vérifiés sur le même texte.
