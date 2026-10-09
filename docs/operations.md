# Exploitation

Procédures pour faire tourner Forever Roster en production : https://forever-roster.sleyvazh.fr, et sa deuxième adresse Roster (WoW Retail) : https://roster.sleyvazh.fr.

## Serveur

| Élément | Choix |
|---|---|
| Hébergement | VPS OVHcloud (VPS-1), datacenter en France |
| Système | Debian 13, mises à jour de sécurité automatiques (`unattended-upgrades`) |
| Accès | SSH par clé ed25519 uniquement, sur l'utilisateur `debian` |
| Pare-feu | UFW : 22/tcp (limité), 80/tcp, 443/tcp, 443/udp, en IPv4 et IPv6. Tout le reste est refusé en entrée. |
| Anti-bruteforce | fail2ban sur SSH (5 échecs en 10 min = 1 h de bannissement) |
| Application | Docker Compose : PostgreSQL + API + Caddy (HTTPS Let's Encrypt automatique) |
| E-mails | `no-reply@sleyvazh.fr` via le SMTP OVH (Zimbra), SPF et DKIM configurés |

### Durcissement SSH

`/etc/ssh/sshd_config.d/00-hardening.conf` :

```
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AuthenticationMethods publickey
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowUsers debian
```

Le préfixe `00-` compte : sshd garde la **première** valeur lue pour chaque paramètre. Or l'image cloud fournit `50-cloud-init.conf`, qui autorise les mots de passe.

Vérification : `sudo sshd -T | grep -Ei 'passwordauth|permitroot|allowusers'`.

### Pourquoi `sudo docker` et pas le groupe `docker`

Appartenir au groupe `docker` revient à être root sans mot de passe : on peut monter `/` dans un conteneur. Sur un serveur exposé, on garde donc `sudo`.

## Première installation

```bash
git clone https://github.com/Sleyvazh/forever-roster.git ~/forever-roster
cd ~/forever-roster
# Créer .env (droits 600) : voir .env.example. Secrets générés sur le serveur (openssl rand -hex 32).
sudo docker compose up -d --build
```

Prérequis : l'enregistrement DNS `A` du domaine doit pointer vers le serveur **avant** le premier lancement, sinon Caddy ne peut pas obtenir le certificat.

## Déployer une nouvelle version

Sur son PC : commit et push sur `main`. Ensuite, sur le serveur, on peut lancer le déploiement tout de suite :

```bash
~/forever-roster/scripts/deploy.sh
```

Le script :

1. vérifie la CI GitHub du commit à déployer (tests, bout en bout, CodeQL, images Docker) et **attend qu'elle soit terminée**. Il interroge l'API publique de GitHub toutes les 30 s pendant 20 min au maximum, et annule si une vérification échoue ;
2. sauvegarde la base ;
3. récupère `main` en *fast-forward* uniquement (il refuse si le serveur a des modifications locales) ;
4. reconstruit les images et redémarre les conteneurs ;
5. vérifie `https://<domaine>/api/health` pendant 60 s ;
6. en cas d'échec, affiche la commande de retour arrière.

En cas d'urgence (GitHub indisponible, correctif critique), `deploy.sh --skip-ci` déploie sans attendre la CI.

Le script est entièrement contenu dans une fonction : bash le lit en entier avant de l'exécuter, donc sa propre mise à jour par `git merge` ne peut plus perturber le déploiement en cours.

Les migrations de base de données s'appliquent automatiquement au démarrage de l'API.

### Retour arrière

```bash
cd ~/forever-roster
git log --oneline -5
git checkout <commit-précédent>
sudo docker compose up -d --build
# Une fois le correctif poussé sur main : git checkout main && scripts/deploy.sh
```

Si une migration a modifié la base de façon incompatible, restaurer aussi la sauvegarde faite par `deploy.sh` (voir plus bas).

## Surveillance

Un service externe vérifie que le site répond et prévient par e-mail sinon. Exemple avec UptimeRobot (offre gratuite, contrôle toutes les 5 min) :

1. Créer un compte, puis **New monitor** de type **HTTP(s) - Keyword** ;
2. URL `https://forever-roster.sleyvazh.fr/api/health`, mot-clé `"ok":true` ;
3. Alerte par e-mail vers son adresse personnelle (pas `no-reply@`).

L'endpoint `/api/health` ne donne aucune information interne et ne touche pas la base, il peut être interrogé souvent.

## Sauvegardes

### Installation (une fois)

```bash
cd ~/forever-roster
sudo install -m 700 infra/backup/forever-backup.sh /usr/local/sbin/forever-backup.sh
sudo install -m 644 infra/backup/forever-backup.service infra/backup/forever-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now forever-backup.timer
```

### Fonctionnement

- Chaque nuit vers 3 h 30 (`systemctl list-timers forever-backup.timer`), rattrapée au démarrage si le serveur était éteint.
- `pg_dump --format=custom` dans `/var/backups/forever-roster/`, lisible par root uniquement.
- L'archive est vérifiée (`pg_restore --list`) avant d'être conservée.
- Rotation : 14 jours.
- Journal des exécutions : `journalctl -u forever-backup.service`.

### Test de restauration (à faire régulièrement)

Restaure la dernière sauvegarde dans une base temporaire et compare avec la production :

```bash
cd ~/forever-roster
LAST=$(sudo sh -c 'ls -1t /var/backups/forever-roster/forever-*.dump | head -1')
sudo docker compose exec -T db sh -c 'createdb -U "$POSTGRES_USER" restore_test'
sudo cat "$LAST" | sudo docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d restore_test --no-owner'
for DB in restore_test '"$POSTGRES_DB"'; do
  sudo docker compose exec -T db sh -c "psql -U \"\$POSTGRES_USER\" -d $DB -c 'select (select count(*) from users) as comptes, (select count(*) from characters) as persos;'"
done
sudo docker compose exec -T db sh -c 'dropdb -U "$POSTGRES_USER" restore_test'
```

Dernier test réussi : 24/09/2026.

### Restauration complète de la production

```bash
cd ~/forever-roster
sudo docker compose stop api
sudo cat /var/backups/forever-roster/forever-AAAAMMJJ-HHMM.dump \
  | sudo docker compose exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner'
sudo docker compose start api
```

### Copie hors serveur

Une sauvegarde qui reste sur le VPS ne protège pas contre la perte du VPS. Pour l'instant, une copie est rapatriée à la main chaque semaine :

```bash
# Sur le serveur
LAST=$(sudo sh -c 'ls -1t /var/backups/forever-roster/forever-*.dump | head -1')
sudo install -m 600 -o debian -g debian "$LAST" ~/latest.dump
```

```powershell
# Sur le PC
scp forever:latest.dump "$HOME\Backups\forever-roster\forever-$(Get-Date -Format yyyyMMdd).dump"
ssh forever "rm ~/latest.dump"
```

Évolution prévue : restic vers un stockage objet, avec chiffrement côté client.

## Opérations courantes

| Besoin | Commande |
|---|---|
| État des conteneurs | `sudo docker compose ps` |
| Journaux de l'API | `sudo docker compose logs -f --tail=100 api` |
| Échecs d'envoi d'e-mails | `sudo docker compose logs api \| grep -i "Échec d'envoi"` |
| Modifier `.env` puis l'appliquer | `sudo docker compose up -d api` (`restart` ne relit **pas** le `.env`) |
| IP bannies par fail2ban | `sudo fail2ban-client status sshd` |
| Règles du pare-feu | `sudo ufw status verbose` |
| Espace disque Docker | `sudo docker system df` |
| Ajouter un admin du site (signalements) | `sudo docker compose exec api node dist/site-admin.js add <e-mail>` |

### Changer le mot de passe SMTP

Après l'avoir changé dans l'espace client OVH (Zimbra), réécrire la ligne `SMTP_URL` sans jamais afficher le mot de passe :

```bash
cd ~/forever-roster
read -rsp "Mot de passe de no-reply@sleyvazh.fr : " SMTP_PASS; echo
SMTP_PASS="$SMTP_PASS" python3 - <<'PY'
import os, urllib.parse
p = urllib.parse.quote(os.environ["SMTP_PASS"], safe="")
lines = open(".env").read().splitlines()
lines = [f"SMTP_URL=smtps://no-reply%40sleyvazh.fr:{p}@smtp.mail.ovh.net:465" if l.startswith("SMTP_URL=") else l for l in lines]
open(".env", "w").write("\n".join(lines) + "\n")
PY
unset SMTP_PASS
sudo docker compose up -d api
```

## Deuxième adresse : Roster (WoW Retail)

Un seul site, deux adresses : même serveur, même code, même base. L'adresse de la requête choisit le jeu (`forever` ou `retail`), le nom, le logo, la couleur, la page d'accueil publique, l'adresse des liens dans les e-mails et les invitations, et le retour de la connexion Discord. Les comptes sont communs (même e-mail, même mot de passe, même liaison Discord) ; la connexion se fait une fois par adresse (cookie propre à chaque sous-domaine). Persos et groupes appartiennent à un jeu : chaque adresse ne montre que les siens.

Tant que `RETAIL_ORIGIN` et `RETAIL_DOMAIN` sont vides, seul Forever Roster existe. Roster reste fermé jusqu'à l'addon Retail (lot R3) : une fois connecté, on n'y voit que le compte et « Roster arrive bientôt », sauf avec l'accès anticipé ci-dessous.

Mise en service, **dans cet ordre** (Caddy ne peut obtenir le certificat que si le DNS pointe déjà vers le serveur) :

1. **DNS chez OVH** : *Web Cloud → Noms de domaine → sleyvazh.fr → Zone DNS → Ajouter une entrée → CNAME*, sous-domaine `roster`, cible `forever-roster.sleyvazh.fr.` (avec le point final). Vérifier sur le serveur, après quelques minutes : `getent hosts roster.sleyvazh.fr` doit donner l'adresse du serveur.
2. **Discord** (<https://discord.com/developers/applications>, application Forever Roster → OAuth2 → Redirects) : ajouter `https://roster.sleyvazh.fr/api/auth/discord/callback` à côté de celle de Forever Roster, puis **Save Changes**. Rien d'autre ne change chez Discord : un seul bot pour les deux sites.
3. **`.env` sur le serveur** (ce ne sont pas des secrets) :

   ```bash
   cd ~/forever-roster
   python3 - <<'PY'
   vals = {"RETAIL_ORIGIN": "https://roster.sleyvazh.fr", "RETAIL_DOMAIN": "roster.sleyvazh.fr"}
   lines = [l for l in open(".env").read().splitlines() if l.split("=", 1)[0] not in vals]
   lines += [f"{k}={v}" for k, v in vals.items()]
   open(".env", "w").write("\n".join(lines) + "\n")
   PY
   sudo docker compose up -d api web
   ```

4. **Vérifier** : `curl -s https://roster.sleyvazh.fr/api/site` doit répondre `"game":"retail"`, et <https://roster.sleyvazh.fr> afficher l'accueil de Roster. Si le certificat manque : `sudo docker compose logs --tail=30 web`. `deploy.sh` vérifie ensuite les deux adresses.

Bot Discord : `/roster-lier` fait la même chose que `/forever-lier` (un code de groupe Roster ou Forever Roster, peu importe la commande). Le bot enregistre ses commandes à chaque démarrage : rien à faire après le déploiement (relancer Discord avec Ctrl+R si la commande n'apparaît pas tout de suite).

Battle.net (quand il sera activé) : déclarer aussi `https://roster.sleyvazh.fr/api/auth/battlenet/callback` chez Blizzard.

### Accès anticipé à Roster

Avant l'ouverture, quelques comptes (Flo et les officiers) utilisent Roster en entier. Le compte doit exister (inscription sur l'une des deux adresses) ; sur le serveur :

```bash
cd ~/forever-roster
sudo docker compose exec api node dist/roster-preview.js add flo@example.com     # donner l'accès
sudo docker compose exec api node dist/roster-preview.js list                    # qui l'a
sudo docker compose exec api node dist/roster-preview.js remove flo@example.com  # le retirer
```

La personne recharge la page de Roster : un badge « Accès anticipé » s'affiche en haut. Ce qui est déjà là (lot R2a) : persos créés à la main (nom, royaume, classe, spés, liens Armurerie / Raider.IO / Warcraft Logs, notes), groupes, raids Normal / Héroïque / Mythique avec l'effectif de chaque difficulté (10 à 30 ; Mythique 20, ou 15 à 25 pour les raids flexibles), inscriptions, compo et buffs de raid de Midnight, annonces Discord. Depuis R2b : import des persos depuis Battle.net et « Mettre à jour » (niveau, niveau d'objet, spé active), voir plus bas. Depuis R3a : l'addon Roster (page Addon, `/downloads/Roster.zip` construit avec le site), « Copier pour le jeu » (raids à venir), l'« Export pour le jeu » de la compo, et le bilan collé (Ctrl+V) par un officier : onglets Bilan du raid et Présence & butin du groupe (migration `0031`, appliquée au démarrage de l'API). Depuis R3b : la distribution du butin par l'addon Roster. Mode de butin de chaque raid (création, raids récurrents, onglet Butin du raid) : « Journal » ou « Conseil (distribution par Roster) », pas de soft reserve sur Roster (l'API la refuse) ; conseil choisi pour le raid dans l'onglet Butin ; *Administration → Butin* règle le compte des objets reçus (saison, 30 jours ou X raids, par joueur ou par perso), calculé d'après les bilans, avec les corrections et le « Ne pas compter » des officiers ; « Copier pour le jeu » envoie aussi le conseil et les objets reçus à l'addon. Aucune migration. Retours du raid de test : détail des objets reçus (BiS, Upgrade, jets MS) dans Présence & butin, sur la fiche du joueur et dans « Copier pour le jeu » (ligne `D` du RRG, lue par l'addon 0.3), catégorie facultative des corrections, historique importé en une correction BiS et une correction Upgrade par joueur (migration `0033` : colonne `loot_corrections.kind`, appliquée au démarrage de l'API ; les corrections déjà faites restent sans catégorie, dans le total seulement ; pour le détail d'un historique déjà importé, retirer ses corrections sur la fiche des joueurs puis recoller la liste). Pas encore : préparation et Roster Companion pour Roster (R3c).

### Signalements (bug, idée, question)

Sur les deux adresses, chaque joueur connecté a **Signaler un bug ou une idée** dans le menu de son compte : type (bug, idée, question), partie concernée (site, addon, bot, Companion), titre, détails, et une capture d'écran facultative (fichier, glisser-déposer ou Ctrl+V ; réduite à 1 600 px et ré-encodée en WebP, jointe dans les 15 minutes). La page, le navigateur, le site et la dernière version de l'addon vue à l'import sont ajoutés d'office. Il suit ses signalements et les réponses dans **Mes signalements** (pastille sur l'avatar tant qu'une réponse n'est pas lue). Limite : 5 signalements par 10 minutes.

**Admins du site** (page `/admin/signalements`, statut Nouveau / En cours / Fait / Refusé, réponse visible sur le site seulement, suppression) :

```bash
cd ~/forever-roster
sudo docker compose exec api node dist/site-admin.js add flo@example.com     # ajouter (le compte doit exister)
sudo docker compose exec api node dist/site-admin.js list                    # qui l'est
sudo docker compose exec api node dist/site-admin.js remove flo@example.com  # retirer
```

La personne recharge la page : **Signalements (admin)** apparaît dans le menu de son compte.

**Salon Discord des admins :** un admin du site, avec son Discord lié dans Compte & sécurité, tape `/signalements-lier` dans un salon **privé** (commande visible des membres qui peuvent gérer le serveur). Le bot y poste chaque signalement (texte, auteur, site, page, navigateur, addon, capture, lien vers la page admin), puis met le message à jour quand le statut ou la réponse change ; supprimer un signalement supprime son message. Il prévient si le salon est visible par @everyone. Le salon étant privé, ajoute le bot à ses membres (Modifier le salon → Permissions → ajouter le rôle du bot). Droits du bot dans ce salon : Voir le salon, Envoyer des messages, Intégrer des liens, et Joindre des fichiers pour les captures (sinon elles restent sur le site). Un seul salon pour les deux adresses : relancer la commande ailleurs déplace les messages. Seuls les signalements des 30 derniers jours sont suivis dans Discord.

### Import Battle.net (Roster)

Même application Blizzard que la connexion Battle.net (`BNET_CLIENT_ID`, `BNET_CLIENT_SECRET`), rien de plus à déclarer : l'adresse de retour de Roster (`https://roster.sleyvazh.fr/api/auth/battlenet/callback`) suffit. Région Europe (`BNET_API_HOST`, par défaut `https://eu.api.blizzard.com`).

- « Importer depuis Battle.net » (Mes persos, sur Roster) : Battle.net demande au joueur l'accord pour la liste de ses persos WoW (`wow.profile`). Le jeton du joueur sert une fois, n'est pas gardé ; la liste reste 30 minutes (table `bnet_imports`). Les persos au niveau 90 sont cochés, le reste au choix ; une fiche déjà faite à la main (même nom, même royaume) est reliée, pas doublée.
- « Mettre à jour » (fiche) et, pour les officiers, « Mettre à jour le groupe » (onglet Personnages) : profil public du perso avec le jeton de l'application (niveau, niveau d'objet équipé, spé active). Rien d'automatique : chaque lecture part d'un clic. La spé principale choisie sur le site ne change pas ; « Prendre … comme spé principale » la remplace sur demande.
- Profil masqué ou perso renommé : « introuvable chez Blizzard ». Changer le nom ou le royaume d'une fiche la détache de Battle.net.
- Journal du compte : « Liste des persos lue sur Battle.net », « Persos importés de Battle.net ».

Langue des noms du jeu (classes, spés, raids, buffs) : chaque compte choisit dans *Compte et sécurité → Noms du jeu* (français, anglais, ou comme le navigateur). Sur Discord, les menus d'inscription suivent la langue de Discord du joueur ; l'annonce publique est en français. Forever Roster garde les noms anglais de WoW Forever.

Référencement : chaque adresse sert sa propre page d'accueil statique (titre, description, aperçu pour les réseaux) et `robots.txt` (tout sauf `/api/`). Pour suivre l'indexation, ajouter les deux adresses dans Google Search Console (facultatif).

## Données du jeu (objets et recettes)

Les recherches d'objets (onglet Équipement), les patrons (onglet Métiers) et l'onglet Artisans des groupes s'appuient sur les tables du client de WoW Forever, publiées en CSV par [wago.tools](https://wago.tools). ForeverChanges et forever-ref utilisent la même source. Wowhead n'a pas d'API publique et interdit l'aspiration de ses pages. Le site y renvoie donc seulement par des liens.

L'import télécharge 12 tables, plus 19 tables de détail pour les infobulles et les talents (≈ 2 minutes), et remplace les données en une seule transaction :

```bash
cd ~/forever-roster
bash scripts/import-gamedata.sh                                                 # dernière version (+ cache du client s'il est là)
sudo docker compose exec api node dist/import-gamedata.js                       # dernière version de Forever
sudo docker compose exec api node dist/import-gamedata.js --build 1.60.1.70009  # version précise
```

À relancer après chaque nouvelle version du client (patch, lancement du 4 novembre). La version importée s'affiche avec `curl -s https://forever-roster.sleyvazh.fr/api/gamedata/status` (une session est nécessaire, donc depuis le navigateur connecté).

- **Patrons des joueurs :** les patrons cochés sont liés à l'identifiant du sort de fabrication, qui ne change pas d'une version à l'autre. Un réimport ne les efface pas.
- **Équipement :** l'objet choisi garde son nom en clair en plus de son identifiant. La fiche reste lisible même si l'objet disparaît du client.
- **Objets manquants du client :** une partie des objets de Forever (même d'origine, comme Serpent's Shoulders) n'est pas dans les fichiers du jeu : le serveur les envoie au client (correctifs à chaud), et wago.tools ne les publie pas. L'import les complète avec les objets d'origine de la dernière version de Classic Era (identifiants inférieurs à 30 000, sans la Saison de la Découverte), marqués « données Classic Era » sur le site. Un objet présent dans le client Forever n'est jamais remplacé. Options : `--no-era` pour s'en passer, `--era-dir` pour des CSV locaux.
- **Infobulles :** armure, caractéristiques, dégâts des armes, effets « Équipé : » et bonus de set sont calculés à l'import à partir des barèmes du client (RandPropPoints, ItemArmor*, ItemDamage*, Spell*, ItemSet). Si une de ces tables manque ou change de structure, l'import continue et les infobulles se limitent au nom, à l'emplacement et au niveau. Pas encore affichés : durabilité et dégâts des armes à distance. Le nom de l'icône de chaque objet est retrouvé via la [liste de fichiers communautaire](https://github.com/wowdev/wow-listfile) (`--no-icons` pour sauter cette étape).
- **Talents :** les arbres de Forever ne sont pas ceux de Classic. Le jeu utilise le système `C_Traits` : les talents viennent des tables Trait* (un arbre par classe, avec ses trois spés côte à côte). L'import en tire la position de chaque talent (palier, colonne), son rang maximal, son prérequis, son icône et sa description, dans l'ordre du calculateur ForeverChanges. La vue « Arbres » de la fiche lit donc les rangs d'un lien du calculateur, ou de l'export de l'addon. Le journal affiche « Talents : N talents pour 9 classes » ; si ces tables manquent, les talents déjà importés restent en place.
- **Recettes en double :** le client contient aussi des recettes de la Saison de la Découverte, au même nom qu'une recette d'origine mais dont l'objet n'existe pas sur Forever. L'import garde la version dont l'objet est connu, et reporte sur elle les patrons que les joueurs avaient cochés sur l'autre.
- **Changement de structure :** si Blizzard modifie la structure d'une table, l'import s'arrête avant d'écrire quoi que ce soit (« colonnes manquantes ») et les données existantes restent en place.

### Objets révélés en jeu (cache du client)

Environ 40 % des objets de Forever ne sont pas dans les fichiers du jeu : le serveur les envoie aux clients quand un joueur les découvre, et chaque client les garde dans `Cache\ADB\<langue>\DBCache.bin`. Pour les ajouter au site :

1. Fermer le jeu, puis copier le fichier sur le serveur (depuis le PC, PowerShell) :
   ```powershell
   ssh forever "mkdir -p ~/forever-roster/gamedata"
   scp "C:\Games\World of Warcraft\_classic_beta_\Cache\ADB\enUS\DBCache.bin" forever:~/forever-roster/gamedata/
   ```
2. Sur le serveur : `bash scripts/import-gamedata.sh`. Le script utilise `gamedata/DBCache.bin` s'il existe (dossier ignoré par Git).

Les objets du cache complètent les fichiers du jeu sans jamais les remplacer, et passent avant le complément Classic Era. Plus le client a joué, plus il en contient : recommencer de temps en temps (après la sortie : `_classic_` au lieu de `_classic_beta_`). Si Blizzard change le format, l'import s'arrête sans rien écrire (« le format du client a changé »).

En développement : `npm run gamedata:import -w apps/api` (options `--build` ou `--dir <dossier de CSV>`).

## Icônes du jeu

Les icônes (classes, arbres de talents, métiers, puis objets) sont des fichiers de Blizzard : elles restent sur le serveur, dans `~/forever-roster/icons/` (ignoré par Git), et Caddy les sert sous `/icons/`. Les visiteurs ne contactent aucun site tiers. Si une icône manque, le site affiche l'initiale de la classe à la place.

Ajouter un lot d'icônes reçu sur le PC :

```powershell
scp -r "$HOME\Pictures\WoWicons" forever:~/wowicons
```

```bash
cd ~/forever-roster
python3 scripts/normalize-icons.py ~/wowicons      # range et renomme dans icons/
rm -r ~/wowicons
```

Noms reconnus : `ClassIcon_<classe>.png`, `<Classe><n>-<Spé ou arbre>.png` et `Profession_<Métier>.png`. Le nom après le tiret désigne une spé (`Druid3-FeralCat`, `Druid2-FeralGuardian` pour Feral Bear, `Shaman3-EnhancementTankRockbiter` pour Enhancement Tank) ou un arbre (`Paladin1-Holy` vaut pour Holy Heal et Holy DPS ; une icône de spé précise l'emporte sur celle de l'arbre) ; le numéro sert seulement à trier. Les icônes sont rangées dans `icons/spec/<classe>-<spé>.png` (ex. `druid-feral-bear.png`). Le script liste les fichiers ignorés. Rien à redémarrer pour le site : les nouvelles icônes sont servies immédiatement (cache navigateur d'une semaine). Pour les émojis Discord, `sudo docker compose restart bot`.

En développement, copier le dossier `icons/` dans `apps/web/public/icons/` (lui aussi ignoré par Git).

### Emblèmes de faction

`scripts/fetch-item-icons.sh` télécharge aussi les étendards de la Horde et de l'Alliance (icônes `inv_bannerpvp_01` et `inv_bannerpvp_02`) dans `icons/faction/`. Tant qu'ils manquent, le site affiche l'étiquette texte « HORDE » ou « ALLI ».

Il extrait aussi les **icônes de rôle** du jeu (Tank, Heal, DPS) dans `icons/roles/` (`tank.png`, `heal.png`, `dps.png`) : ce sont des morceaux d'une texture de l'interface (atlas `UI-LFG-RoleIcon-*`), retrouvés dans les tables `UiTextureAtlasMember` et `UiTextureAtlas` du client, téléchargés en BLP depuis wago.tools puis découpés en PNG 64×64 transparents (`dist/role-icons.js`). Le bot en fait les émojis `fr_role_tank`, `fr_role_heal` et `fr_role_dps` (au plus 6 h après, ou en redémarrant le bot). Tant qu'elles manquent, le site et le bot écrivent le rôle en toutes lettres.

### Icônes des objets

L'import retrouve le nom de l'icône de chaque objet (liste de fichiers communautaire), puis `scripts/import-gamedata.sh` appelle `scripts/fetch-item-icons.sh`. Ce script télécharge les icônes manquantes depuis le serveur d'images officiel de Blizzard (`render.worldofwarcraft.com`) dans `icons/items/`, une seule fois chacune (≈ 3 000 fichiers, ≈ 10 Mo). Les visiteurs ne contactent toujours que notre serveur. Seuls les noms simples (`a-z`, `0-9`, `_`, `-`) sont acceptés, et un fichier n'est gardé que s'il s'agit bien d'un JPEG.

```bash
bash scripts/fetch-item-icons.sh                 # relançable à tout moment
SKIP_ICONS=1 bash scripts/import-gamedata.sh     # import sans téléchargement d'icônes
```

Beaucoup d'objets (surtout ceux de Forever) n'ont pas d'icône propre dans la table Item : l'import prend alors celle de leur apparence (ItemModifiedAppearance → ItemAppearance), comme le jeu. Les icônes que le serveur d'images de Blizzard ne sert pas (récentes, propres à Forever) et celles dont le nom est inconnu (fichier nommé `f<identifiant>`) sont ensuite récupérées dans les fichiers du jeu par leur identifiant, sur wago.tools (format BLP), puis converties en JPEG 56×56 par `dist/blp-icons.js` dans un conteneur `api` temporaire. Branches essayées : `WAGO_BRANCHES` (par défaut `wow_classic_beta,wow_classic,wow_classic_era`).

Si une icône reste introuvable, le site affiche le pictogramme de son emplacement.

## Bot Discord

Le bot publie les raids dans un salon Discord, avec des boutons d'inscription sur le modèle de Raid-Helper. Il tourne dans le conteneur `bot`, sans port ouvert : il se connecte à Discord en sortie, et à l'API par le port interne 3001, qui n'est joignable que sur le réseau Docker. Tant que `DISCORD_BOT_TOKEN` est vide, il reste en veille.

### Créer l'application Discord (une fois)

Sur <https://discord.com/developers/applications>, **New Application** (« Forever Roster ») :

1. **Installation** : *Install Link* → **None**. Discord refuse sinon l'étape 3.
2. **OAuth2** : ajouter la redirection `https://forever-roster.sleyvazh.fr/api/auth/discord/callback`. Noter le **Client ID** (public). **Reset Secret** donne le **Client Secret** : ne le coller que dans le terminal du serveur (étape suivante).
3. **Bot** : décocher **Public Bot** (toi seul peux l'inviter), laisser les trois *Privileged Gateway Intents* **désactivés**. **Reset Token** donne le jeton du bot : même règle que le secret.
4. Inviter le bot sur le serveur Discord, en remplaçant `CLIENT_ID` :
   `https://discord.com/oauth2/authorize?client_id=CLIENT_ID&scope=bot+applications.commands&permissions=84992`
   (droits : Voir les salons, Envoyer des messages, Intégrer des liens, Voir les anciens messages. Rien d'autre.
   « Voir les anciens messages » sert aux réponses sous les avis ; sur un serveur où le bot est déjà, l'ajouter à son rôle.)

### Renseigner les secrets sur le serveur

Les valeurs sont tapées sans écho et ne passent jamais par l'historique du shell, ni par une conversation :

```bash
cd ~/forever-roster
read -rp  "Client ID Discord : " DISCORD_CLIENT_ID
read -rsp "Client Secret Discord : " DISCORD_CLIENT_SECRET; echo
read -rsp "Jeton du bot : " DISCORD_BOT_TOKEN; echo
INTERNAL_API_SECRET=$(openssl rand -hex 32)
export DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_BOT_TOKEN INTERNAL_API_SECRET
python3 - <<'PY'
import os
keys = ["DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_BOT_TOKEN", "INTERNAL_API_SECRET"]
lines = [l for l in open(".env").read().splitlines() if l.split("=", 1)[0] not in keys]
lines += [f"{k}={os.environ[k].strip()}" for k in keys]
open(".env", "w").write("\n".join(lines) + "\n")
PY
unset DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_BOT_TOKEN INTERNAL_API_SECRET
chmod 600 .env
sudo docker compose up -d api bot
sudo docker compose logs --tail=5 bot     # attendu : « Connecté en tant que Forever Roster#… »
```

Pour changer un seul secret (jeton régénéré chez Discord, par exemple), relancer le bloc en entier : les quatre lignes sont réécrites, et `INTERNAL_API_SECRET` change aussi, ce qui est sans conséquence.

### Utilisation

1. Chaque joueur lie son Discord dans **Compte & sécurité** : ses clics dans le bot l'inscrivent alors avec ses persos. Sans liaison, il peut quand même s'inscrire en choisissant classe et spé (marqué ✱ sur le site).
2. Un officier (Discord lié) génère un code dans l'encart **Salon Discord** (Administration → Discord et relances), puis tape `/forever-lier code:XXXXXXXX` dans le salon voulu. Code valable 30 minutes, une seule fois.
3. Les raids à venir y sont publiés dans les secondes qui suivent. Toute inscription, sur le site ou sur Discord, met l'annonce à jour.
4. `/raid nom:Molten Core date:12/11/2026 21:00 description:…` crée un raid depuis Discord (officiers, heure de Paris).

5. **Raids récurrents** : dans l'onglet Raids du groupe, « + Nouveau raid » puis la case « Chaque semaine » (ex. Molten Core, mercredi 20:30, créé 7 jours avant) ; la liste se déplie avec « ↻ Récurrents » (pause, modification, suppression). L'API crée les occurrences au démarrage puis toutes les 15 minutes. Un raid supprimé à la main n'est pas recréé.
6. **Compo** : sur la page d'un raid (onglet Compo), « Publier la compo » en haut remplace les colonnes par rôle de l'annonce par les 8 groupes.
7. **Rappels** : la veille (entre 24 h et 1 h avant), le bot envoie un message privé à chaque inscrit qui vient ou hésite, avec les boutons de statut. Les comptes liés peuvent les couper dans Compte & sécurité. Un joueur qui refuse les messages privés du serveur est simplement ignoré. Changer la date du raid renvoie un rappel.
8. **Relance des sans-réponse** (lot D2) : 48 h avant le raid par défaut (24, 48 ou 72 h, ou désactivée, dans Administration → Salon Discord), le bot écrit en privé aux membres du groupe qui n'ont donné aucune réponse, avec Présent / Peut-être / Absent. Une seule relance automatique par raid, jamais pour un raid créé il y a moins de 2 h ; changer la date la réarme. Les officiers reçoivent en même temps la liste : relancés, MP fermés, sans Discord lié, messages du bot coupés. Sur la page du raid, l'encart « Pas encore répondu » montre la liste et « Relancer maintenant » (une fois par heure, sans prévenir les officiers).
9. **Demander à X** (lot D2) : dans l'encart Besoins, « Demander » sur un alt d'un inscrit ou le main d'un membre sans réponse. Le bot lui écrit en privé (sous 15 s) : « Oui, avec <perso> » l'inscrit présent avec ce perso et cette spé (à la place de son inscription actuelle), « Non » est simplement noté. L'état (demandé, a dit oui / non, MP impossible) s'affiche sur le site. Une demande par perso et par raid, annulable.

Les relances et les demandes respectent le réglage « Messages privés du bot » de Compte & sécurité.

10. **Commandes d'artisanat** (lot F) : dans Administration → Discord et relances, encart **Salon des commandes d'artisanat**, « Générer un code », puis `/forever-lier code:XXXXXXXX` dans un salon dédié (celui des raids marche aussi, mais les annonces s'y mélangent). La même commande sert aux deux salons : le code dit lequel est lié. Le bot y poste chaque commande passée depuis l'onglet Artisans (objet, quantité, demandeur, artisans du groupe qui connaissent la recette, composants fournis, détails) avec un bouton **Je m'en charge** (Discord lié et membre du groupe, pas pour sa propre commande). Le message suit la commande (prise, faite) ; annuler la commande, changer de salon ou délier le supprime. Une commande faite reste affichée 14 jours sur le site. Au plus 10 commandes en cours par joueur.
11. **Absences déclarées** (lot F) : chaque joueur, sur Mes persos, déclare une période (du … au …, 6 mois au plus) ou des jours de la semaine. Les raids à venir de ces jours **sans réponse** passent en « Absent » avec la note « Absence déclarée », dans tous ses groupes, y compris les raids créés plus tard (raid ajouté, récurrent généré, `/raid`, date changée, groupe rejoint). Une réponse déjà donnée n'est jamais remplacée. Retirer l'absence enlève les « Absent » qu'elle avait posés (sauf si une autre absence couvre encore ce jour). Le motif est facultatif ; le joueur choisit s'il est visible des officiers ou de tout le groupe (fiche joueur). Ces « Absent » n'envoient ni relance ni rappel.

Changer de salon ou délier efface les anciennes annonces. Supprimer un raid ou le groupe aussi. Une annonce reste synchronisée jusqu'à 12 heures après l'heure du raid.

### Avis (feedback)

Fonction autonome : un serveur Discord l'utilise sans groupe ni compte sur le site, et sans l'addon, pour n'importe quel jeu.

1. **Activer** (membre avec « Gérer le serveur ») : `/feedback-config regler destination:#avis-equipe bouton:#donner-son-avis anonyme:True`.
   - `destination` : salon **privé** de l'équipe, où arrivent les avis. Le bot prévient s'il est visible par @everyone.
   - `bouton` (facultatif) : salon dédié où le bot pose le message « Donner mon avis ». Il le **verrouille** (plus personne n'y écrit, @everyone garde la lecture) s'il a le droit « Gérer les permissions » **sur ce salon** : à donner sur ce salon seulement, pas au rôle du bot. Sinon il indique quoi retirer à la main.
   - `anonyme` : `False` pour n'accepter que des avis signés.
   - `site` et `groupe` (facultatifs) : **suivi sur le site** par un groupe (voir 4). La liste ne propose que les groupes du site choisi déjà liés à ce serveur (salon des raids ou des commandes, `/forever-lier` ou `/roster-lier`) ; « Aucun » arrête le suivi.
   - Relancer la commande change les réglages (l'ancien bouton est retiré) ; sans l'option `groupe`, le groupe qui suit les avis reste le même. `/feedback-config retirer` désactive tout.
2. **Donner son avis** : `/feedback` depuis n'importe quel salon, ou le bouton. Le bot écrit en MP, le joueur répond par un message (1 800 caractères), voit un aperçu, puis choisit **Envoyer signé** ou **Envoyer anonyme**. MP fermés : le bot propose une fenêtre pour écrire sur le serveur. Limite : 1 avis par minute et 5 par heure par personne.
3. **Répondre** : bouton « Répondre » sous chaque avis. La réponse part en MP à l'auteur, sans que l'équipe sache qui il est si l'avis est anonyme ; elle est aussi notée sous l'avis. L'auteur peut répondre à son tour (toujours anonyme).
4. **Suivi sur le site** (groupe choisi au réglage) : chaque avis arrive aussi dans **Administration → Avis** du groupe, visible du chef et des officiers seulement (pastille sur l'onglet tant qu'il y a du nouveau). Ils y voient le fil (avis, réponses de l'équipe depuis Discord ou le site, réponses de l'auteur), changent le statut (Nouveau, En cours, Fait, Refusé ; une première réponse passe à « En cours »), répondent (le bot envoie la réponse en MP et la note sous l'avis, à la relève suivante) ou suppriment l'avis (son message dans le salon de l'équipe aussi). Le message de l'avis dans Discord montre le statut et un bouton « Voir sur le site ». L'aperçu prévient le joueur que les officiers du groupe verront son avis sur le site ; un avis anonyme reste anonyme sur le site. « Ne plus recevoir » (sur le site) arrête le suivi sans toucher aux avis déjà reçus. Le journal du groupe note qui a relié ou retiré les avis.

**Ce qui est gardé :** les réglages du serveur. Sans suivi par un groupe : pour chaque avis, le lien avis ↔ auteur pendant 30 jours (table `feedbacks`, pour la réponse), puis il est effacé ; le texte reste uniquement dans Discord. Avec un groupe : texte, nom de l'auteur d'un avis signé, statut et conversation (`feedbacks`, `feedback_messages`) jusqu'à ce qu'un officier supprime l'avis ; l'auteur (identifiant Discord, pour la réponse) est oublié 30 jours après « Fait » ou « Refusé », l'avis reste lisible. L'identifiant de l'auteur ne sort jamais vers le site (seul le bot le reçoit). `feedback_seen` garde la dernière visite de chaque officier (pastilles). L'avis en cours d'écriture n'existe qu'en mémoire du bot (perdu au redémarrage). Un avis anonyme ne contient aucune trace de l'auteur dans Discord ; seul l'hébergeur du bot pourrait retrouver l'auteur dans la base pendant ces 30 jours.

**Intents :** le bot utilise *Guilds* et *Direct Messages*. Aucun n'est privilégié : rien à cocher dans le portail. Le contenu des MP envoyés au bot lui est transmis sans l'intent *Message Content*.

**Autres serveurs :** le bot est privé (« Public Bot » décoché) : seul toi peux l'inviter. Pour qu'une autre guilde l'ajoute elle-même, cocher **Public Bot** et lui donner le lien d'invitation ci-dessus. Les commandes de raid restent inutiles sans groupe lié sur le site.

**Émojis de classe :** au démarrage, puis toutes les 6 heures, le bot envoie à Discord les icônes de `icons/class/` et `icons/spec/` comme émojis de l'application (`fr_druid`, `fr_druid_feral_bear`…). Ils apparaissent devant les noms dans les annonces. Après l'ajout d'icônes, `sudo docker compose restart bot` les prend en compte tout de suite. Une icône de plus de 256 Ko est ignorée (le journal le signale). Les émojis sont visibles et supprimables dans le portail développeur, onglet **Emojis**.

**Si le bot ne publie pas :** `sudo docker compose logs --tail=30 bot`. « Salon … inaccessible » ou « Missing Access » signifie qu'il manque des droits au bot dans ce salon ; il réessaie de lui-même, de plus en plus espacé (jusqu'à 10 minutes). « jeton du bot invalide » : régénérer le jeton et relancer le bloc ci-dessus.

## Ce que montrent les journaux

Une seconde après l'émission du premier certificat HTTPS, des robots ont demandé `/api/.env`, `/api/config` et `/api/env`. Chaque certificat est publié dans les journaux publics *Certificate Transparency*, que des scanners surveillent pour attaquer les nouveaux sites avant qu'ils soient sécurisés. Toutes ces requêtes ont reçu un 404 : le `.env` est exclu de l'image Docker (`.dockerignore`) et Caddy ne sert que le dossier du front.
