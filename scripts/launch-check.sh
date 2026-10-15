#!/usr/bin/env bash
# Vérification avant (et pendant) le lancement de WoW Forever : docs/lancement-forever.md.
# Usage (sur le serveur, en tant que debian) :
#   bash scripts/launch-check.sh
#   INTERFACE_SORTIE=<numéro> bash scripts/launch-check.sh   compare aussi le .toc de ForeverRoster au client de sortie
# LECTURE SEULE : rien n'est écrit, redémarré ni modifié, et aucune valeur secrète n'est affichée (une variable de .env
# est seulement « définie » ou « vide »). Chaque contrôle est indépendant : un échec n'arrête pas les suivants.
# Résultat : ✓ bon, ✗ à corriger, ? à regarder soi-même. Code de sortie 1 si au moins un ✗.
set -u

cd "$(dirname "$0")/.." || exit 1

if [ -t 1 ]; then G=$'\033[32m' R=$'\033[31m' Y=$'\033[33m' B=$'\033[1m' Z=$'\033[0m'; else G='' R='' Y='' B='' Z=''; fi
N_OK=0 N_KO=0 N_UNK=0
ok()      { N_OK=$((N_OK + 1));   printf '%s✓%s %s\n' "$G" "$Z" "$*"; }
ko()      { N_KO=$((N_KO + 1));   printf '%s✗%s %s\n' "$R" "$Z" "$*"; }
unk()     { N_UNK=$((N_UNK + 1)); printf '%s?%s %s\n' "$Y" "$Z" "$*"; }
section() { printf '\n%s== %s%s\n' "$B" "$1" "$Z"; }

# Valeur d'une variable de .env (dernière occurrence, guillemets retirés). Sert à tester « définie / vide » et à lire
# les noms de domaine ; une valeur secrète ne sort jamais de cette fonction vers l'écran.
env_get() {
  local line v
  line=$(grep -E "^[[:space:]]*(export[[:space:]]+)?$1[[:space:]]*=" .env 2>/dev/null | tail -n 1)
  v=${line#*=}
  v=${v#"${v%%[![:space:]]*}"}
  v=${v%"${v##*[![:space:]]}"}
  case $v in \"*\" | \'*\') v=${v:1:${#v}-2} ;; esac
  printf '%s' "$v"
}
env_defined() { [ -n "$(env_get "$1")" ]; }

# Requête HTTPS : remplit BODY et CODE (000 si injoignable)
BODY='' CODE=000
fetch() {
  local out
  out=$(curl -sS --max-time 10 -w '\n%{http_code}' "$1" 2>/dev/null)
  CODE=${out##*$'\n'}
  BODY=${out%$'\n'*}
  [ -n "$CODE" ] || CODE=000
}

# Champ d'un .toc (« ## Interface: 16001 » → 16001)
toc_field() { sed -n "s/^## $2:[[:space:]]*//p" "$1" 2>/dev/null | head -n 1 | tr -d '\r'; }

fmt_date() { date -d "$1" '+%d/%m/%Y %H:%M' 2>/dev/null || printf '%s' "$1"; }

DOMAIN=$(env_get DOMAIN)
RETAIL_DOMAIN=$(env_get RETAIL_DOMAIN)
case $DOMAIN in '' | localhost) DOMAIN=forever-roster.sleyvazh.fr ;; esac
DOMAINS=("$DOMAIN")
[ -n "$RETAIL_DOMAIN" ] && DOMAINS+=("$RETAIL_DOMAIN")
NOW=$(date +%s)

printf '%sForever Roster : vérification avant lancement (lecture seule), %s%s\n' "$B" "$(date '+%d/%m/%Y %H:%M')" "$Z"
printf 'Dossier : %s ; adresses : %s\n' "$PWD" "${DOMAINS[*]}"

# ---------------------------------------------------------------------------------------------------------------------
section "Code du serveur"
head_sha=$(git rev-parse HEAD 2>/dev/null)
main_sha=$(GIT_TERMINAL_PROMPT=0 timeout 20 git ls-remote origin refs/heads/main 2>/dev/null | cut -f1)
if [ -z "$head_sha" ]; then
  unk "dépôt git illisible (lancer le script en tant que debian, pas avec sudo)"
elif [ -z "$main_sha" ]; then
  unk "serveur en ${head_sha:0:7} ; GitHub injoignable, impossible de comparer avec main"
elif [ "$head_sha" = "$main_sha" ]; then
  ok "serveur en ${head_sha:0:7}, comme main sur GitHub"
else
  unk "serveur en ${head_sha:0:7}, main en ${main_sha:0:7} : pas encore déployé (bash scripts/deploy.sh) ou retour arrière en cours"
fi
if [ -n "$head_sha" ]; then
  if [ -z "$(git --no-optional-locks status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    ok "aucune modification locale des fichiers suivis"
  else
    ko "modifications locales (git status) : deploy.sh refusera de déployer"
  fi
fi

# ---------------------------------------------------------------------------------------------------------------------
section "Conteneurs (sudo docker compose)"
if ! sudo docker compose version >/dev/null 2>&1; then
  ko "sudo docker compose ne répond pas"
else
  for svc in db api bot web; do
    cid=$(sudo docker compose ps -a -q "$svc" 2>/dev/null | head -n 1)
    if [ -z "$cid" ]; then ko "$svc : aucun conteneur (sudo docker compose up -d)"; continue; fi
    state='' health='' restarts=0 started=''
    IFS='|' read -r state health restarts started < <(sudo docker inspect -f \
      '{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{end}}|{{.RestartCount}}|{{.State.StartedAt}}' "$cid" 2>/dev/null)
    since="depuis le $(fmt_date "$started")"
    if [ "$state" != running ]; then
      ko "$svc : ${state:-état inconnu} (sudo docker compose logs --tail=50 $svc)"
    elif [ "$health" = unhealthy ]; then
      ko "$svc : en marche mais en mauvaise santé (sudo docker compose logs --tail=50 $svc)"
    elif [ "$health" = starting ]; then
      unk "$svc : en cours de démarrage, relancer le script dans une minute"
    elif [ "${restarts:-0}" != 0 ]; then
      unk "$svc : en marche $since, mais redémarré seul $restarts fois (sudo docker compose logs --tail=50 $svc)"
    else
      ok "$svc : en marche${health:+ et sain} $since"
    fi
  done
fi

# ---------------------------------------------------------------------------------------------------------------------
section "Site et API (adresses publiques)"
for d in "${DOMAINS[@]}"; do
  if [ "$d" = "$DOMAIN" ]; then game=forever; else game=retail; fi
  fetch "https://$d/api/health"
  if [ "$CODE" = 200 ] && [[ $BODY == *'"ok":true'* ]]; then ok "https://$d/api/health répond"
  else ko "https://$d/api/health : HTTP $CODE (sudo docker compose logs --tail=50 api web)"; fi
  fetch "https://$d/api/site"
  if [ "$CODE" = 200 ] && [[ $BODY == *"\"game\":\"$game\""* ]]; then ok "https://$d/api/site : jeu $game"
  else ko "https://$d/api/site : HTTP $CODE, jeu $game attendu"; fi
  fetch "https://$d/"
  if [ "$CODE" = 200 ]; then ok "https://$d/ : page d'accueil servie"
  else ko "https://$d/ : HTTP $CODE"; fi
done

fetch "https://$DOMAIN/api/sync/key"
key_id=$(printf '%s' "$BODY" | grep -o '"keyId":"[0-9a-f]*"' | cut -d'"' -f4)
if [ "$CODE" = 404 ]; then
  ko "pas de clé de signature sur le site (SYNC_SIGNING_KEY vide) : pas de partage entre joueurs"
elif [ -z "$key_id" ]; then
  ko "https://$DOMAIN/api/sync/key : HTTP $CODE, keyId illisible"
elif grep -q "SITE_KEYS\[\"$key_id\"\]" addon/shared/SiteKey.lua 2>/dev/null; then
  ok "clé de signature du site ($key_id) connue des addons (addon/shared/SiteKey.lua)"
else
  ko "clé de signature du site ($key_id) absente de addon/shared/SiteKey.lua : les addons refuseront les données partagées"
fi

# ---------------------------------------------------------------------------------------------------------------------
section "Certificats TLS"
for d in "${DOMAINS[@]}"; do
  end=$(timeout 20 openssl s_client -connect "$d:443" -servername "$d" </dev/null 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null)
  end=${end#notAfter=}
  end_s=$(date -d "$end" +%s 2>/dev/null)
  if [ -z "$end" ] || [ -z "$end_s" ]; then ko "$d : certificat illisible (sudo docker compose logs --tail=30 web)"; continue; fi
  days=$(( (end_s - NOW) / 86400 ))
  msg="$d : expire le $(fmt_date "$end"), dans $days j"
  if [ "$days" -lt 7 ]; then ko "$msg : Caddy ne le renouvelle pas (sudo docker compose logs --tail=50 web)"
  elif [ "$days" -lt 14 ]; then unk "$msg : renouvellement par Caddy en retard ? (sudo docker compose logs --tail=50 web)"
  else ok "$msg (Caddy le renouvelle seul)"; fi
done

# ---------------------------------------------------------------------------------------------------------------------
section "Bot Discord"
line=$(sudo docker compose logs --no-log-prefix bot 2>/dev/null \
  | grep -E 'Connecté en tant que|Connexion à Discord impossible|DISCORD_BOT_TOKEN absent' | tail -n 1)
case $line in
  *"Connecté en tant que"*)
    tag=${line#*Connecté en tant que }
    ok "connecté à Discord en tant que ${tag%"${tag##*[![:space:]]}"} (depuis le $(fmt_date "${line%% *}"))" ;;
  *"Connexion à Discord impossible"*)
    ko "connexion à Discord refusée le $(fmt_date "${line%% *}") (jeton du bot invalide ? sudo docker compose logs --tail=30 bot)" ;;
  *"DISCORD_BOT_TOKEN absent"*)
    ko "DISCORD_BOT_TOKEN vide : le bot est en veille" ;;
  *)
    unk "aucune ligne de connexion dans le journal du bot (sudo docker compose logs --tail=50 bot)" ;;
esac
bot_warn=$(sudo docker compose logs --no-log-prefix --since 1h bot 2>/dev/null | grep -c -E 'impossible|inaccessible|Missing Access|Error')
if [ "${bot_warn:-0}" = 0 ]; then ok "aucun avertissement du bot dans l'heure"
else unk "$bot_warn avertissement(s) du bot dans l'heure (sudo docker compose logs --since 1h bot)"; fi

# ---------------------------------------------------------------------------------------------------------------------
section "Journal de l'API"
api_err=$(sudo docker compose logs --no-log-prefix --since 1h api 2>/dev/null | grep -c -E '"level":(50|60)')
if [ "${api_err:-0}" = 0 ]; then ok "aucune erreur de l'API dans l'heure"
else unk "$api_err erreur(s) de l'API dans l'heure (sudo docker compose logs --since 1h api | grep '\"level\":50')"; fi
mail_err=$(sudo docker compose logs --no-log-prefix --since 24h api 2>/dev/null | grep -c "Échec d'envoi")
if [ "${mail_err:-0}" = 0 ]; then ok "aucun échec d'envoi d'e-mail en 24 h"
else unk "$mail_err échec(s) d'envoi d'e-mail en 24 h (SMTP, docs/operations.md, « Opérations courantes »)"; fi

# ---------------------------------------------------------------------------------------------------------------------
section "Espace disque"
while read -r mnt pct avail; do
  p=${pct%\%}
  [[ $p =~ ^[0-9]+$ ]] || continue
  msg="$mnt : $pct utilisés, $avail Go libres"
  if [ "$p" -ge 90 ]; then ko "$msg (sudo docker system df)"
  elif [ "$p" -ge 80 ]; then unk "$msg (sudo docker system df)"
  else ok "$msg"; fi
done < <(df -P / /var/lib/docker /var/backups 2>/dev/null | awk 'NR > 1 && !seen[$1]++ { printf "%s %s %.1f\n", $6, $5, $4 / 1048576 }')

# ---------------------------------------------------------------------------------------------------------------------
section "Sauvegardes (docs/operations.md, « Sauvegardes »)"
if systemctl is-enabled --quiet forever-backup.timer 2>/dev/null && systemctl is-active --quiet forever-backup.timer 2>/dev/null; then
  next=$(systemctl show forever-backup.timer -p NextElapseUSecRealtime --value 2>/dev/null)
  result=$(systemctl show forever-backup.service -p Result --value 2>/dev/null)
  if [ "$result" = success ]; then ok "minuterie forever-backup.timer active, dernier passage réussi ; prochain : ${next:-?}"
  else ko "dernier passage de forever-backup.service : ${result:-inconnu} (journalctl -u forever-backup.service -n 30)"; fi
else
  ko "minuterie forever-backup.timer inactive (installation : docs/operations.md, « Sauvegardes »)"
fi

dumps=$(sudo find /var/backups/forever-roster -maxdepth 1 -name 'forever-*.dump' -printf '%T@ %s %f\n' 2>/dev/null | sort -n)
if [ -z "$dumps" ]; then
  ko "aucune sauvegarde dans /var/backups/forever-roster"
else
  read -r ts size name <<<"$(printf '%s\n' "$dumps" | tail -n 1)"
  age_h=$(( (NOW - ${ts%.*}) / 3600 ))
  n=$(printf '%s\n' "$dumps" | wc -l)
  msg="dernière sauvegarde : $name ($(numfmt --to=iec --suffix=o "$size" 2>/dev/null || echo "$size o")), il y a $age_h h ; sauvegardes sur le serveur : $n"
  if [ "$age_h" -le 26 ] && [ "$size" -gt 0 ]; then ok "$msg"
  else ko "$msg : la sauvegarde de la nuit manque (journalctl -u forever-backup.service -n 30)"; fi
fi

if [ -e "$HOME/latest.dump" ]; then
  unk "$HOME/latest.dump du $(date -r "$HOME/latest.dump" '+%d/%m/%Y') : copie hors serveur préparée mais pas encore récupérée ni supprimée"
fi
unk "copie hors serveur : invérifiable d'ici (copiée à la main sur le PC). Sur le PC : Get-ChildItem \"\$HOME\\Backups\\forever-roster\" | Sort-Object LastWriteTime | Select-Object -Last 1"

restore=$(sed -n 's/.*Dernier test réussi : \([0-9][0-9]\)\/\([0-9][0-9]\)\/\([0-9]\{4\}\).*/\3-\2-\1/p' docs/operations.md 2>/dev/null | head -n 1)
restore_s=$(date -d "$restore" +%s 2>/dev/null)
if [ -z "$restore" ] || [ -z "$restore_s" ]; then
  unk "date du dernier test de restauration introuvable dans docs/operations.md"
else
  restore_d=$(( (NOW - restore_s) / 86400 ))
  if [ "$restore_d" -le 30 ]; then ok "dernier test de restauration noté : $(date -d "$restore" '+%d/%m/%Y') (il y a $restore_d j)"
  else unk "dernier test de restauration noté : $(date -d "$restore" '+%d/%m/%Y') (il y a $restore_d j) : à refaire"; fi
fi

# ---------------------------------------------------------------------------------------------------------------------
section "Données du jeu (docs/operations.md, « Données du jeu »)"
# Requête en lecture seule (transaction read only imposée par PGOPTIONS) ; $POSTGRES_* sont lues dans le conteneur.
# shellcheck disable=SC2016
meta=$(sudo docker compose exec -T db sh -c \
  'PGOPTIONS="-c default_transaction_read_only=on" psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F "|" -v ON_ERROR_STOP=1' \
  2>/dev/null <<'SQL'
SELECT coalesce((SELECT value FROM game_meta WHERE key = 'build'), ''),
       coalesce((SELECT value FROM game_meta WHERE key = 'importedAt'), ''),
       coalesce((SELECT value FROM game_meta WHERE key = 'cacheBuild'), ''),
       coalesce((SELECT value FROM game_meta WHERE key = 'cacheItems'), '0'),
       (SELECT count(*) FROM game_items),
       (SELECT count(*) FROM game_talents);
SQL
)
build='' imported='' cache_build='' cache_items=0 items=0 talents=0
IFS='|' read -r build imported cache_build cache_items items talents <<<"$meta"
if [ -z "$meta" ]; then
  ko "lecture de la base impossible (conteneur db arrêté ?)"
elif [ -z "$build" ] || [ "${items:-0}" = 0 ]; then
  ko "aucune donnée du jeu importée (bash scripts/import-gamedata.sh)"
else
  ok "version $build importée le $(fmt_date "$imported") : $items objets, $talents talents"
fi

if [ -n "$build" ]; then
  if [ -z "$cache_build" ]; then
    unk "aucun cache du client importé (gamedata/DBCache.bin, voir « Objets révélés en jeu »)"
  elif [ "$cache_build" = "${build##*.}" ]; then
    ok "cache du client du même build ($cache_build) : $cache_items objets révélés en jeu ajoutés"
  else
    unk "cache du client d'un autre build ($cache_build, données en ${build##*.}) : recopier DBCache.bin depuis le client puis réimporter"
  fi
fi

latest=''
if command -v python3 >/dev/null 2>&1; then
  # Même choix que l'import (apps/api/src/gamedata/source.ts) : version 1.60 ou plus, hors produits régionaux si possible
  latest=$(curl -sS --max-time 15 -A 'forever-roster launch-check' https://wago.tools/api/builds 2>/dev/null | python3 -c '
import json, re, sys
data = json.load(sys.stdin)
def key(v):
    try: return [int(x) for x in v.split(".")]
    except ValueError: return None
for allow_regional in (False, True):
    best = None
    for product, builds in data.items():
        if not isinstance(builds, list) or (not allow_regional and re.search(r"_(cn|kr|tw)(_|$)", product)): continue
        for b in builds:
            k = key(b.get("version", "")) if isinstance(b, dict) else None
            if k and len(k) >= 2 and k[0] == 1 and k[1] >= 60 and (best is None or k > key(best[0])): best = (b["version"], product)
    if best: print(best[0], best[1]); break
' 2>/dev/null)
fi
if [ -z "$latest" ]; then
  unk "dernière version de Forever sur wago.tools : illisible (site injoignable ?)"
elif [ "${latest%% *}" = "$build" ]; then
  ok "à jour : $build est la dernière version de Forever sur wago.tools (${latest#* })"
else
  unk "wago.tools a ${latest%% *} (${latest#* }), la base a ${build:-rien} : bash scripts/import-gamedata.sh"
fi

# ---------------------------------------------------------------------------------------------------------------------
section "Variables de .env (définie ou vide, jamais la valeur)"
if [ ! -f .env ]; then
  ko ".env introuvable dans $PWD"
else
  perm=$(stat -c %a .env 2>/dev/null)
  if [ "$perm" = 600 ]; then ok ".env : droits 600"
  else ko ".env : droits ${perm:-?}, 600 attendus (chmod 600 .env)"; fi

  check_vars() { # check_vars <libellé> <variables obligatoires…>
    local label=$1 v missing=()
    shift
    for v in "$@"; do env_defined "$v" || missing+=("$v"); done
    if [ ${#missing[@]} -eq 0 ]; then ok "$label : $* $([ $# -gt 1 ] && echo définies || echo définie)"
    else ko "$label : vide(s) ${missing[*]}"; fi
  }
  check_pair() { # check_pair <libellé> <A> <B> <texte si les deux sont vides> : facultatif, mais pas à moitié
    local a=0 b=0
    env_defined "$2" && a=1
    env_defined "$3" && b=1
    if [ $a = 1 ] && [ $b = 1 ]; then ok "$1 : $2 et $3 définies"
    elif [ $a = 0 ] && [ $b = 0 ]; then unk "$1 : $2 et $3 vides ($4)"
    else ko "$1 : seulement l'une de $2 et $3 est définie"; fi
  }
  check_vars "Site" APP_ORIGIN DOMAIN
  check_vars "Base" POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB
  check_vars "E-mails" SMTP_URL MAIL_FROM
  check_vars "Discord" DISCORD_CLIENT_ID DISCORD_CLIENT_SECRET DISCORD_BOT_TOKEN INTERNAL_API_SECRET
  check_vars "Partage signé" SYNC_SIGNING_KEY
  check_pair "Battle.net" BNET_CLIENT_ID BNET_CLIENT_SECRET "connexion Battle.net désactivée, facultative pour Forever"
  check_pair "Roster (Retail)" RETAIL_ORIGIN RETAIL_DOMAIN "deuxième adresse désactivée"
fi

# ---------------------------------------------------------------------------------------------------------------------
section "Addons (.toc du dépôt cloné)"
fr_toc=addon/ForeverRoster/ForeverRoster.toc
fr_iface=$(toc_field "$fr_toc" Interface)
fr_ver=$(toc_field "$fr_toc" Version)
if [ -z "$fr_iface" ]; then
  ko "$fr_toc : « ## Interface » illisible"
elif [ -n "${INTERFACE_SORTIE:-}" ]; then
  if [[ ",${fr_iface// /}," == *",$INTERFACE_SORTIE,"* ]]; then ok "ForeverRoster $fr_ver : ## Interface: $fr_iface, celle du client de sortie"
  else ko "ForeverRoster $fr_ver : ## Interface: $fr_iface, le client de sortie est en $INTERFACE_SORTIE"; fi
else
  unk "ForeverRoster $fr_ver : ## Interface: $fr_iface, à comparer au client de sortie (en jeu : /run print((select(4, GetBuildInfo())))), puis INTERFACE_SORTIE=<numéro> bash scripts/launch-check.sh"
fi
ro_toc=addon/Roster/Roster.toc
if [ -n "$(toc_field "$ro_toc" Interface)" ]; then
  ok "Roster $(toc_field "$ro_toc" Version) : ## Interface: $(toc_field "$ro_toc" Interface) (WoW Retail, rien à changer pour Forever)"
else
  ko "$ro_toc : « ## Interface » illisible"
fi

fetch "https://$DOMAIN/downloads/ForeverRoster.json"
site_ver=$(printf '%s' "$BODY" | grep -o '"version": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
site_iface=$(printf '%s' "$BODY" | grep -o '"interface": *"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/')
if [ "$CODE" != 200 ] || [ -z "$site_ver" ]; then
  ko "https://$DOMAIN/downloads/ForeverRoster.json : HTTP $CODE (zip de l'addon non servi)"
elif [ "$site_ver" = "$fr_ver" ] && [ "$site_iface" = "$fr_iface" ]; then
  ok "le site sert ForeverRoster $site_ver (interface $site_iface), comme le dépôt"
else
  unk "le site sert ForeverRoster $site_ver (interface $site_iface), le dépôt est en $fr_ver ($fr_iface) : bash scripts/deploy.sh"
fi

# ---------------------------------------------------------------------------------------------------------------------
printf '\n%sBilan : %s%d ✓%s, %s%d ?%s, %s%d ✗%s%s\n' "$B" "$G" "$N_OK" "$Z$B" "$Y" "$N_UNK" "$Z$B" "$R" "$N_KO" "$Z$B" "$Z"
[ "$N_KO" -eq 0 ]
