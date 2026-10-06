#!/usr/bin/env bash
# Télécharge les icônes d'objets et de talents manquantes dans icons/items/, et les icônes de rôle dans icons/roles/
# (fichiers de Blizzard, jamais dans Git).
# Les noms viennent de la base (details.icon et details.iconId, remplis par l'import) ; chaque icône n'est
# téléchargée qu'une fois : d'abord depuis le serveur d'images officiel de Blizzard, puis, pour les icônes
# qu'il ne sert pas (récentes, propres à Forever), depuis les fichiers du jeu (wago.tools, format BLP
# converti en JPEG par dist/blp-icons.js). Caddy les sert sous /icons/items/.
# Appelé à la fin de scripts/import-gamedata.sh ; peut être relancé seul sans risque.
set -euo pipefail
cd "$(dirname "$0")/.."
DEST=icons/items
CDN=https://render.worldofwarcraft.com/us/icons/56
mkdir -p "$DEST" icons/faction

# Emblèmes de faction (étendards de bataille du jeu) : icons/faction/horde.jpg et alliance.jpg
for pair in "horde inv_bannerpvp_01" "alliance inv_bannerpvp_02"; do
  set -- $pair
  [ -s "icons/faction/$1.jpg" ] || curl -fsS --retry 2 --max-time 20 -o "icons/faction/$1.jpg" "$CDN/$2.jpg" || rm -f "icons/faction/$1.jpg"
done

# Icônes de rôle (Tank, Heal, DPS) : atlas de l'interface du jeu découpés en PNG, icons/roles/tank.png, heal.png, dps.png.
# Sans elles, le site et le bot écrivent le rôle en toutes lettres.
mkdir -p icons/roles
if [ ! -s icons/roles/tank.png ] || [ ! -s icons/roles/heal.png ] || [ ! -s icons/roles/dps.png ]; then
  sudo docker compose run --rm --no-deps -T --user "$(id -u):$(id -g)" -v "$PWD/icons/roles:/out" api node dist/role-icons.js /out \
    || echo "Icônes de rôle : non récupérées (le site affiche le texte à la place)."
fi

all=$(mktemp); pairs=$(mktemp); todo=$(mktemp); fails=$(mktemp); blp=$(mktemp)
trap 'rm -f "$all" "$pairs" "$todo" "$fails" "$blp"' EXIT
sudo docker compose exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -F " "' > "$all" <<'SQL'
SELECT DISTINCT details->>'icon', coalesce(details->>'iconId', '') FROM game_items WHERE details ? 'icon'
UNION SELECT icon, coalesce(icon_id::text, '') FROM game_talents WHERE icon IS NOT NULL;
SQL

# Seuls des noms simples sont acceptés : ils servent à construire une URL et un chemin de fichier.
grep -E '^[a-z0-9_-]{1,100} [0-9]*$' "$all" | sort -u -k1,1 > "$pairs" || true
while read -r n fid; do [ -s "$DEST/$n.jpg" ] || echo "$n $fid"; done < "$pairs" > "$todo"
total=$(wc -l < "$pairs"); count=$(wc -l < "$todo")
echo "Icônes d'objets : $total au total, $count à télécharger."
[ "$count" -eq 0 ] && exit 0

export DEST CDN
# 1. Serveur d'images de Blizzard (noms connus ; « f<identifiant> » = nom inconnu, directement à l'étape 2)
cut -d" " -f1 "$todo" | grep -v -E '^f[0-9]+$' | xargs -r -P 8 -n 1 sh -c '
  n=$1; part="$DEST/$n.jpg.part"
  if curl -fsS --retry 2 --max-time 20 -o "$part" "$CDN/$n.jpg" 2>/dev/null \
     && [ "$(od -An -tx1 -N3 "$part" | tr -d " ")" = "ffd8ff" ]; then
    mv "$part" "$DEST/$n.jpg"
  else
    rm -f "$part"; echo "$n"
  fi' _ > "$fails"

cdn=$(( $(cut -d" " -f1 "$todo" | grep -cv -E '^f[0-9]+$' || true) - $(wc -l < "$fails") ))
echo "Serveur d'images de Blizzard : $cdn icônes téléchargées."

# 2. Le reste depuis les fichiers du jeu, par identifiant (« identifiant nom » pour le convertisseur)
awk -v F="$fails" 'BEGIN { while ((getline l < F) > 0) failed[l] = 1 }
  ($1 ~ /^f[0-9]+$/ || $1 in failed) && $2 != "" { print $2, $1 }' "$todo" | sort -u > "$blp"
if [ -s "$blp" ]; then
  echo "Fichiers du jeu : $(wc -l < "$blp") icônes à convertir…"
  sudo docker compose run --rm --no-deps -T --user "$(id -u):$(id -g)" -v "$PWD/$DEST:/out" api node dist/blp-icons.js /out < "$blp"
fi
