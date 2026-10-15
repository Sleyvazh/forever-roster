# Lancement de WoW Forever (5 novembre 2026)

Liste à suivre pour la sortie de WoW Forever, le **5 novembre 2026 (J)**. Chaque commande dit où elle se lance : **serveur** (`ssh forever`, puis `cd ~/forever-roster`, bash) ou **PC** (PowerShell, dans `C:\Dev\forever-roster`). Les procédures déjà écrites restent dans [operations.md](operations.md) : on y renvoie.

Contrôle rapide à tout moment, **serveur** : `bash scripts/launch-check.sh` ([le script](../scripts/launch-check.sh), lecture seule : ✓ bon, ✗ à corriger, ? à regarder soi-même ; code de sortie 1 s'il reste un ✗). Une fois le numéro d'interface du client de sortie connu : `INTERFACE_SORTIE=<numéro> bash scripts/launch-check.sh`.

Si Blizzard publie le client de sortie dès le 4 novembre, faire les étapes 1 à 4 du jour J ce jour-là.

## J-21 à J-7 (15 → 29 octobre)

- [ ] **Premier contrôle.** Une fois cette liste sur `main`, serveur : `bash scripts/deploy.sh` (pour avoir le script), puis `bash scripts/launch-check.sh`. Corriger chaque ✗. Les ? normaux à ce stade : copie hors serveur, interface du client de sortie, Battle.net s'il reste coupé.
- [ ] **Les sauvegardes tournent.** Serveur :
  ```bash
  systemctl list-timers forever-backup.timer
  journalctl -u forever-backup.service -n 20 --no-pager    # une ligne « Sauvegarde OK : … » par nuit
  ```
  Bon si : launch-check montre la minuterie active, un dernier passage réussi et une sauvegarde de moins de 26 h.
- [ ] **Vrai test de restauration** (le dernier date du 24/09, avant l'arrivée des joueurs de la sortie). Serveur : bloc de [Test de restauration](operations.md#test-de-restauration-à-faire-régulièrement). Bon si : les deux lignes `comptes | persos` sont identiques (à ce qui a été créé depuis la sauvegarde de la nuit près) et `restore_test` est supprimée à la fin. Puis PC : date du jour dans « Dernier test réussi » d'operations.md, commit, push (launch-check lit cette date).
- [ ] **Copie hors serveur.** [Copie hors serveur](operations.md#copie-hors-serveur) (serveur puis PC). Bon si, sur le PC, `Get-ChildItem "$HOME\Backups\forever-roster" | Sort-Object LastWriteTime | Select-Object -Last 1` donne le fichier du jour, de la taille annoncée par launch-check, et si `~/latest.dump` n'existe plus sur le serveur.
- [ ] **L'alerte du site arrive vraiment.** UptimeRobot ([Surveillance](operations.md#surveillance)) : créer un monitor de test « HTTP(s) - Keyword » sur `https://forever-roster.sleyvazh.fr/api/health` avec un mot-clé absent (`"ok":false`, alerte s'il manque, comme le vrai). Bon si l'e-mail d'alerte arrive dans les 10 minutes ; supprimer ce monitor. Ajouter le vrai monitor de `https://roster.sleyvazh.fr/api/health` s'il n'existe pas.
- [ ] **Le bot n'est pas surveillé.** `/api/health` ne dépend ni du bot ni de la base : si le bot tombe, rien ne prévient. En attendant mieux, `bash scripts/launch-check.sh` chaque jour de J-1 à J+7 (section « Bot Discord »).
- [ ] **Répéter l'import des données du jeu sur la bêta**, pour vérifier que la procédure du jour J marche encore (wago.tools, structure des tables) et mesurer sa durée. Serveur : `bash scripts/import-gamedata.sh` ([Données du jeu](operations.md#données-du-jeu-objets-et-recettes)). Bon si : le journal finit par « Import terminé : { build: '1.60.…' … } » et launch-check dit « à jour » pour wago.tools.
- [ ] **CurseForge : relever l'état du projet ForeverRoster** sur authors.curseforge.com : numéro du projet, fichiers déjà envoyés (Beta ou Release), versions de jeu proposées pour Forever (le `.toc` actuel demande `1.60.1`). Dans GitHub (Settings > Secrets and variables > Actions) : secret `CF_API_TOKEN` présent, variable `CF_PROJECT_FOREVER` égale à ce numéro (ou ligne `## X-Curse-Project-ID` dans le `.toc`). Essai à blanc : Actions > CurseForge > Run workflow, addon ForeverRoster, type release, « Essai à blanc » coché. Bon si le run est vert et annonce la version du `.toc` et « jeu 1.60.1 ».
- [ ] **Battle.net : décider.** Côté Forever, Battle.net ne sert qu'à se connecter ou à lier son compte (OpenID) ; l'import des persos n'existe que pour Roster (Retail) : Forever n'est pas (encore) dans l'API de profil de Blizzard ([architecture.md](architecture.md), « Pistes pour la suite »). `BNET_CLIENT_ID` est vide en production : rien d'obligatoire pour la sortie. Pour l'activer, voir J-7 à J-1.

## J-7 à J-1 (29 octobre → 4 novembre)

- [ ] **Gel à J-3 (2 novembre)** : ensuite, correctifs seulement, toujours par `bash scripts/deploy.sh` (CI verte) ; `--skip-ci` en urgence seulement. Bon si : launch-check dit « serveur en …, comme main sur GitHub ».
- [ ] **(Facultatif) Connexion Battle.net.** Sur develop.battle.net/access/clients, créer un client avec deux Redirect URLs : `https://forever-roster.sleyvazh.fr/api/auth/battlenet/callback` et `https://roster.sleyvazh.fr/api/auth/battlenet/callback`. Puis serveur (le secret est tapé sans écho, jamais ailleurs) :
  ```bash
  cd ~/forever-roster
  read -rp  "Client ID Battle.net : " BNET_CLIENT_ID
  read -rsp "Client Secret Battle.net : " BNET_CLIENT_SECRET; echo
  export BNET_CLIENT_ID BNET_CLIENT_SECRET
  python3 - <<'PY'
  import os
  keys = ["BNET_CLIENT_ID", "BNET_CLIENT_SECRET"]
  lines = [l for l in open(".env").read().splitlines() if l.split("=", 1)[0] not in keys]
  lines += [f"{k}={os.environ[k].strip()}" for k in keys]
  open(".env", "w").write("\n".join(lines) + "\n")
  PY
  unset BNET_CLIENT_ID BNET_CLIENT_SECRET
  chmod 600 .env
  sudo docker compose up -d api
  ```
  Bon si : `curl -s https://forever-roster.sleyvazh.fr/api/auth/me` contient `"battlenetEnabled":true`, et « Se connecter avec Battle.net » (page de connexion) ramène sur le site, connecté, avec son propre compte.
- [ ] **Préparer le raid à blanc.** Site : créer le raid de la soirée de lancement (date, format, mode de butin, conseil choisi dans l'onglet Butin) ; il est publié dans le salon Discord du groupe. Discord : annoncer la soirée, demander à chacun de lier son Discord (Compte & sécurité) et de s'inscrire, une moitié par le site, l'autre par les boutons de l'annonce. Scénario détaillé : `raid-a-blanc.html` (hors dépôt, écrit pour l'addon 1.1). Bon si : l'annonce est dans le salon et les premières inscriptions apparaissent sur le site comme sur Discord.
- [ ] **Prévenir les joueurs** (salon des raids du groupe) : le dossier du jeu change à la sortie (`_classic_` attendu au lieu de `_classic_beta_`, à confirmer le jour J) : recopier l'addon dans `World of Warcraft\_classic_\Interface\AddOns\` ; Roster Companion : Options > Dossier du jeu > Changer, si le dossier bêta avait été choisi à la main. L'addon pour le client de sortie arrive le jour J (page Addon du site, puis CurseForge).
- [ ] **J-1 : contrôle complet.** Serveur : `bash scripts/launch-check.sh`, aucun ✗. Copie hors serveur du jour. **Noter la version des données du jeu** (ligne « version … importée ») : c'est la version de repli si l'import du jour J tourne mal.

## Jour J (5 novembre)

- [ ] **1. Relever les infos du client de sortie** (PC, en jeu) : `/run print(GetBuildInfo())` affiche la version, le build, la date et le numéro d'interface (4e valeur). Noter aussi le nom du dossier du jeu dans `C:\Games\World of Warcraft\`. Si l'addon actuel est refusé (« périmé »), cocher « Charger les AddOns périmés » dans la liste des AddOns en attendant l'étape 2.
- [ ] **2. Addon ForeverRoster pour le client de sortie.** PC :
  ```powershell
  cd C:\Dev\forever-roster
  git pull
  ```
  Dans `addon/ForeverRoster/ForeverRoster.toc` : `## Interface:` = numéro relevé, `## Version:` suivante. Section `## <version>` en tête de `addon/ForeverRoster/CHANGELOG.md` (anglais puis français). Facultatif : la ligne `GetBuildInfo` de `addon/tests/wow_sim.lua` au build de sortie. Puis :
  ```powershell
  git commit -am "ForeverRoster <version> : client de sortie de WoW Forever"
  git push
  ```
  Serveur : `bash scripts/deploy.sh` (les zips du site sont reconstruits). Bon si : `INTERFACE_SORTIE=<numéro> bash scripts/launch-check.sh` met ✓ sur la ligne ForeverRoster et sur « le site sert ForeverRoster <version> … comme le dépôt » ; en jeu, l'addon téléchargé depuis la page Addon se charge sans « périmé ».
- [ ] **3. CurseForge en Release**, seulement si CurseForge propose la version de jeu de Forever qui correspond au numéro relevé (le script la déduit : 16001 → 1.60.1). À relever sur authors.curseforge.com (envoi d'un fichier du projet, liste des versions). Si elle y est, PC :
  ```powershell
  git tag forever-v<version>
  git push origin forever-v<version>
  ```
  Sans suffixe `-beta`, c'est un fichier Release : le seul que l'appli CurseForge installe d'office, et celui qui fait apparaître le projet dans l'appli ([CurseForge](operations.md#curseforge-addons)). Bon si : le run « CurseForge » de l'onglet Actions est vert (« Envoyé : fichier … en attente de modération »), puis le fichier est visible sur la page du projet après modération. Si la version n'est pas proposée : ne rien taguer, revoir chaque jour (J+1 à J+7). Un tag poussé trop tôt échoue sur « Aucune des versions … n'existe sur CurseForge » sans rien envoyer : « Re-run all jobs » sur ce run quand la version arrive.
- [ ] **4. Données du jeu du client de sortie**, dès que launch-check annonce sur wago.tools le build relevé à l'étape 1. Serveur :
  ```bash
  sudo /usr/local/sbin/forever-backup.sh                  # sauvegarde avant l'import, comme deploy.sh
  bash scripts/import-gamedata.sh --build <version>.<build>   # ceux de l'étape 1, ex. forme 1.60.1.70170
  ```
  Bon si : le journal finit par « Import terminé : { build: '<version>.<build>' … } » ; launch-check dit « à jour » ; sur le site, la recherche d'un objet de Forever (onglet Équipement d'un perso) donne son infobulle, et la vue « Arbres » des talents s'affiche. Le `gamedata/DBCache.bin` de la bêta reste utilisé jusqu'à son remplacement (J+1 à J+7).
- [ ] **5. Raid à blanc** (soir), chacun avec l'addon de l'étape 2 et `/console scriptErrors 1`. Serveur, pendant la soirée : `sudo docker compose logs -f --tail=50 api bot`. À vérifier :
  - inscriptions : celles du site et celles des boutons Discord apparaissent des deux côtés, l'annonce suit ; le rappel en MP de la veille est arrivé ;
  - partage signé : un officier fait « Copier pour le jeu » puis Ctrl+V dans l'addon ; les autres voient « Données de <groupe> reçues de <perso> » dans le chat, et l'onglet Synchro « reçues de … » ;
  - addon en raid : Compo > Inviter, Placer les groupes ; En raid > « Addon dans le raid » : tout le monde « À jour » avec la nouvelle version ;
  - relevé : « REC » sur le bouton de la minicarte à l'heure du raid ; la fiche du boss (onglet Préparation) s'ouvre en le ciblant ;
  - butin : jets MS / OS, conseil (réponses et votes visibles du conseil seul), « Donner à … », échange ;
  - fin : synchro de l'addon (Ctrl+C) puis Ctrl+V sur le site par le chef (ou Roster Companion) ; page du raid, onglet Bilan : présence et butin justes.

  Ce qui casse : un signalement sur le site (menu du compte > « Signaler un bug ou une idée », avec capture), pour tout retrouver dans `/admin/signalements`.
- [ ] **6. Fin de journée.** Serveur : `bash scripts/launch-check.sh` ; copie hors serveur (la base contient maintenant les inscriptions de la sortie).

## J+1 à J+7 (6 → 12 novembre)

- [ ] **Chaque jour** : serveur `bash scripts/launch-check.sh` (le bot surtout), bon si aucun ✗ ; signalements dans `/admin/signalements` ou le salon Discord des admins.
- [ ] **Cache du client de sortie** ([Objets révélés en jeu](operations.md#objets-révélés-en-jeu-cache-du-client)), après quelques soirées de jeu, jeu fermé. PC :
  ```powershell
  scp "C:\Games\World of Warcraft\_classic_\Cache\ADB\enUS\DBCache.bin" forever:~/forever-roster/gamedata/
  ```
  Serveur : `bash scripts/import-gamedata.sh --build <version>.<build>`. Bon si : launch-check affiche « cache du client du même build (…) : N objets révélés en jeu ajoutés ». Recommencer en fin de semaine.
- [ ] **CurseForge** : si la version de jeu manquait le jour J, revoir chaque jour et publier dès qu'elle est là (étape 3 du jour J). Après modération, vérifier que le projet apparaît dans l'appli CurseForge.
- [ ] **Textes de la bêta** (PC, un seul patch) : le chemin `_classic_beta_` est encore écrit sur la page Addon du site (`apps/web/src/pages/AddonPage.tsx`), dans `addon/README.md` (Installation), dans Roster Companion (`apps/companion/src/Setup.tsx`) et dans la commande `scp` d'operations.md (Objets révélés en jeu). Passer au dossier de sortie relevé, et citer CurseForge sur la page Addon une fois le projet en ligne.
- [ ] **J+7** : copie hors serveur ; espace disque sous 80 % dans launch-check (la première semaine remplit base et journaux).

## Vers J+30 (début décembre) : nouveaux raids

D'ici là, les boss des nouveaux raids se saisissent à la main dans l'onglet Préparation.

- [ ] **Relever leurs boss** dès l'ouverture. L'addon apprend chaque rencontre au premier combat et l'écrit (déconnexion ou `/reload`) dans `C:\Games\World of Warcraft\_classic_\WTF\Account\<COMPTE>\SavedVariables\ForeverRoster.lua` : tables `bossNames` (numéro de rencontre → nom) et `bossNpcs` (PNJ → numéro de rencontre). Relever, pour chaque boss : nom anglais, numéro de rencontre, PNJ.
- [ ] **Les ajouter au site.** PC : nouvelle entrée de `RAID_INSTANCES` dans `packages/game-data/src/prep.ts` (clé, nom anglais, alias normalisés comme les autres : minuscules, sans accents ni apostrophes, nom français compris ; boss dans l'ordre, `b("Nom", rencontre, pnj…)`), `npm test -w packages/game-data`, commit, push ; serveur : `bash scripts/deploy.sh`. Bon si : l'onglet Préparation d'un raid qui porte le nom de l'instance propose ses boss.
- [ ] **Patch des raids** : relever la nouvelle version (`/run print(GetBuildInfo())`), réimporter les données du jeu (étape 4 du jour J), recopier `DBCache.bin` après les premiers raids (le butin y est révélé). Si le numéro d'interface change : étapes 2 et 3 du jour J.

## Si ça casse le jour J

- **État** (serveur) : `bash scripts/launch-check.sh`, `sudo docker compose ps`.
- **Journaux** (serveur) :
  - API : `sudo docker compose logs --tail=100 api`
  - site et certificat (Caddy) : `sudo docker compose logs --tail=50 web`
  - bot : `sudo docker compose logs --tail=50 bot` (lecture : [Bot Discord](operations.md#bot-discord), « Si le bot ne publie pas »)
  - base : `sudo docker compose logs --tail=50 db`
  - sauvegardes : `journalctl -u forever-backup.service -n 30`
- **Déploiement raté** : [Retour arrière](operations.md#retour-arrière) (le commit précédent est affiché par `deploy.sh` en cas d'échec) ; si une migration a abîmé la base, [Restauration complète de la production](operations.md#restauration-complète-de-la-production) avec la sauvegarde faite par `deploy.sh`.
- **Import des données du jeu raté** (objets absents, infobulles vides) : réimporter la version notée à J-1, serveur : `bash scripts/import-gamedata.sh --build <version de J-1>`.
- **Addon cassé sur le client de sortie** : « Charger les AddOns périmés » si seul le numéro d'interface manque ; sinon, correctif et nouvelle version (étapes 2 et 3). Le site et le bot marchent sans l'addon : inscriptions et compo restent possibles, le bilan attendra.
- **Bot muet** : `sudo docker compose restart bot` (`up -d bot` s'il est arrêté ou si `.env` a changé) ; « jeton du bot invalide » : [Renseigner les secrets sur le serveur](operations.md#renseigner-les-secrets-sur-le-serveur). Panne de Discord lui-même : <https://discordstatus.com>.
- **Site injoignable** : `sudo docker compose up -d`, puis les journaux de `web` (certificat) ; DNS : `getent hosts forever-roster.sleyvazh.fr` doit donner l'adresse du serveur.
- **Qui prévenir sur Discord** :
  1. les officiers, dans le salon privé de l'équipe : ce qui est cassé, depuis quand, le contournement ;
  2. les joueurs, dans le salon des raids du groupe (celui lié par `/forever-lier`) : un message court (ce qui ne marche pas, quoi faire à la place : s'inscrire sur le site si le bot est muet ; si le site est tombé, donner sa présence dans le salon (le bot passe lui aussi par l'API) ; coller à la main si Roster Companion ne synchronise plus), puis un message quand c'est réparé.
