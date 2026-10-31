#!/usr/bin/env bash
# Sauvegarde quotidienne de la base Forever Roster.
# Installé sur le serveur dans /usr/local/sbin/forever-backup.sh (voir docs/operations.md).
set -euo pipefail

APP_DIR=${APP_DIR:-/home/debian/forever-roster}
DEST=${DEST:-/var/backups/forever-roster}
KEEP_DAYS=${KEEP_DAYS:-14}
FILE="$DEST/forever-$(date +%Y%m%d-%H%M).dump"

umask 077
mkdir -p "$DEST"
trap 'rm -f "$FILE.tmp"' EXIT
cd "$APP_DIR"

# 1. Export au format « custom » de PostgreSQL (compressé, restaurable table par table)
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom' > "$FILE.tmp"

# 2. On vérifie que l'archive est lisible AVANT de la garder
docker compose exec -T db pg_restore --list < "$FILE.tmp" > /dev/null
mv "$FILE.tmp" "$FILE"

# 3. On le signale à l'API (page « État du site » ; sans signal pendant plus de 26 h, les admins sont prévenus).
#    Au mieux : une API arrêtée ne fait pas échouer une sauvegarde réussie.
docker compose exec -T api node dist/site-status.js backup-ok "$(stat -c %s "$FILE")" || true

# 4. Rotation : on supprime les sauvegardes plus anciennes que KEEP_DAYS jours
find "$DEST" -name 'forever-*.dump' -mtime +"$KEEP_DAYS" -delete

echo "Sauvegarde OK : $FILE ($(du -h "$FILE" | cut -f1))"
