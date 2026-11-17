#!/usr/bin/env bash
# Importe les données du jeu (dernière version de Forever sur wago.tools + complément Classic Era).
# Les caches de clients de jeu copiés dans gamedata/ (DBCache.bin, et d'autres fichiers .bin : un par joueur, ex.
# gamedata/DBCache-pahpool.bin) apportent les correctifs du serveur : objets révélés en jeu, leurs effets, sets,
# apparences, talents modifiés, recettes. Ils s'additionnent (le correctif le plus récent l'emporte).
# Arguments supplémentaires transmis tels quels (ex. --build 1.60.1.70124).
set -euo pipefail
cd "$(dirname "$0")/.."
shopt -s nullglob
CACHES=(gamedata/*.bin)
if [ ${#CACHES[@]} -gt 0 ]; then
  for f in "${CACHES[@]}"; do
    echo "Cache du client : $f ($(du -h "$f" | cut -f1), modifié le $(date -r "$f" '+%d/%m/%Y %H:%M'))"
  done
  # Plusieurs fichiers dans un seul flux : « FRCACHES », puis pour chacun sa taille et ses octets (voir splitCaches)
  {
    printf 'FRCACHES\n'
    for f in "${CACHES[@]}"; do printf '%s\n' "$(stat -c %s "$f")"; cat "$f"; done
  } | sudo docker compose exec -T api node dist/import-gamedata.js --cache - "$@"
else
  echo "Pas de cache dans gamedata/ (DBCache.bin) : import sans les correctifs du serveur."
  sudo docker compose exec api node dist/import-gamedata.js "$@"
fi

# Icônes des objets (téléchargées une seule fois chacune)
if [ "${SKIP_ICONS:-}" != "1" ]; then bash scripts/fetch-item-icons.sh; fi
