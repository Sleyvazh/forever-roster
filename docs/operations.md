# Exploitation

Procédures pour faire tourner Forever Roster en production : https://forever-roster.sleyvazh.fr

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

Sur son PC : commit et push sur `main`, puis attendre que la CI GitHub soit verte. Ensuite, sur le serveur :

```bash
~/forever-roster/scripts/deploy.sh
```

Le script :

1. sauvegarde la base ;
2. récupère `main` en *fast-forward* uniquement (il refuse si le serveur a des modifications locales) ;
3. reconstruit les images et redémarre les conteneurs ;
4. vérifie `https://<domaine>/api/health` pendant 60 s ;
5. en cas d'échec, affiche la commande de retour arrière.

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

## Ce que montrent les journaux

Une seconde après l'émission du premier certificat HTTPS, des robots ont demandé `/api/.env`, `/api/config` et `/api/env`. Chaque certificat est publié dans les journaux publics *Certificate Transparency*, que des scanners surveillent pour attaquer les nouveaux sites avant qu'ils soient sécurisés. Toutes ces requêtes ont reçu un 404 : le `.env` est exclu de l'image Docker (`.dockerignore`) et Caddy ne sert que le dossier du front.
