#!/usr/bin/env bash
# Télécharge les icônes d'objets manquantes dans icons/items/ (fichiers de Blizzard, jamais dans Git).
# Les noms viennent de la base (colonne details.icon, remplie par l'import) ; chaque icône n'est
# téléchargée qu'une fois, depuis le serveur d'images officiel de Blizzard. Caddy les sert sous /icons/items/.
# Appelé à la fin de scripts/import-gamedata.sh ; peut être relancé seul sans risque.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=icons/items
CDN=https://render.worldofwarcraft.com/us/icons/56
mkdir -p "$DEST"

all=$(mktemp); todo=$(mktemp); fails=$(mktemp)
trap 'rm -f "$all" "$todo" "$fails"' EXIT
sudo docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At' > "$all" <<'SQL'
SELECT DISTINCT details->>'icon' FROM game_items WHERE details ? 'icon';
SQL

# Seuls des noms simples sont acceptés : ils servent à construire une URL et un chemin de fichier.
grep -E '^[a-z0-9_-]{1,100}$' "$all" | while read -r n; do [ -s "$DEST/$n.jpg" ] || echo "$n"; done > "$todo" || true
total=$(wc -l < "$all"); count=$(wc -l < "$todo")
echo "Icônes d'objets : $total au total, $count à télécharger."
[ "$count" -eq 0 ] && exit 0

export DEST CDN
xargs -P 8 -n 1 sh -c '
  n=$1; part="$DEST/$n.jpg.part"
  if curl -fsS --retry 2 --max-time 20 -o "$part" "$CDN/$n.jpg" 2>/dev/null \
     && [ "$(od -An -tx1 -N3 "$part" | tr -d " ")" = "ffd8ff" ]; then
    mv "$part" "$DEST/$n.jpg"
  else
    rm -f "$part"; echo "$n"
  fi' _ < "$todo" > "$fails"

missing=$(wc -l < "$fails")
echo "$((count - missing)) icônes téléchargées$( [ "$missing" -gt 0 ] && echo ", $missing introuvables (ex. $(head -3 "$fails" | paste -sd, -))")."
