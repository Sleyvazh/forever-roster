#!/usr/bin/env bash
# Importe les données du jeu (dernière version de Forever sur wago.tools + complément Classic Era).
# Les caches de clients de jeu copiés dans gamedata/ (DBCache.bin, et d'autres fichiers .bin : un par joueur, ex.
# gamedata/DBCache-pahpool.bin) apportent les correctifs du serveur : objets révélés en jeu, leurs effets, sets,
# apparences, talents modifiés, recettes. Ils s'additionnent (le correctif le plus récent l'emporte).
# Les caches envoyés par les contributeurs (page Addon, Roster Companion) sont gardés par le site et toujours appliqués.
# Arguments supplémentaires transmis tels quels (ex. --build 1.60.1.70124, ou --if-new pour l'import de la nuit :
# rien n'est fait s'il n'y a ni correctif arrivé, ni nouvelle version du client ; minuterie forever-gamedata.timer).
set -euo pipefail
cd "$(dirname "$0")/.."
shopt -s nullglob
CACHES=(gamedata/*.bin)
set +e
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
  echo "Pas de cache dans gamedata/ : seulement les correctifs envoyés par les contributeurs."
  sudo docker compose exec -T api node dist/import-gamedata.js "$@"
fi
code=$?
set -e
# 3 : --if-new et rien de nouveau, import sauté (pas d'icônes à chercher)
if [ "$code" -eq 3 ]; then exit 0; fi
[ "$code" -eq 0 ] || exit "$code"

# Icônes des objets (téléchargées une seule fois chacune)
if [ "${SKIP_ICONS:-}" != "1" ]; then
  bash scripts/fetch-item-icons.sh
  # Lancé par la minuterie (root) : les icônes restent au propriétaire du dépôt, comme celles téléchargées à la main
  if [ "$(id -u)" -eq 0 ]; then chown -R "$(stat -c %u:%g .)" icons; fi
fi
