#!/usr/bin/env bash
# Importe les données du jeu (dernière version de Forever sur wago.tools + complément Classic Era).
# Si gamedata/DBCache.bin existe (cache d'un client de jeu, copié depuis le PC), les objets révélés
# en jeu qu'il contient sont ajoutés. Arguments supplémentaires transmis tels quels (ex. --build 1.60.1.70124).
set -euo pipefail
cd "$(dirname "$0")/.."
CACHE=gamedata/DBCache.bin
if [ -f "$CACHE" ]; then
  echo "Cache du client : $CACHE ($(du -h "$CACHE" | cut -f1), modifié le $(date -r "$CACHE" '+%d/%m/%Y %H:%M'))"
  sudo docker compose exec -T api node dist/import-gamedata.js --cache - "$@" < "$CACHE"
else
  echo "Pas de $CACHE : import sans les objets révélés en jeu."
  sudo docker compose exec api node dist/import-gamedata.js "$@"
fi

# Icônes des objets (téléchargées une seule fois chacune)
if [ "${SKIP_ICONS:-}" != "1" ]; then bash scripts/fetch-item-icons.sh; fi
