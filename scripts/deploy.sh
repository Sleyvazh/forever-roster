#!/usr/bin/env bash
# Déploie la dernière version de la branche main sur le serveur de production.
# Usage (sur le serveur, en tant que debian) : ~/forever-roster/scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."
DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2)
step() { printf '\n\033[1;33m== %s\033[0m\n' "$1"; }

step "Sauvegarde de la base avant mise à jour"
sudo /usr/local/sbin/forever-backup.sh

step "Récupération du code"
PREVIOUS=$(git rev-parse --short HEAD)
git fetch --quiet origin main
# --ff-only : refuse de déployer si le serveur a des modifications locales ou un historique divergent
git merge --ff-only origin/main
CURRENT=$(git rev-parse --short HEAD)
if [ "$PREVIOUS" = "$CURRENT" ]; then
  echo "Déjà à jour ($CURRENT), reconstruction quand même."
else
  git log --oneline "$PREVIOUS..$CURRENT"
fi

step "Construction des images et redémarrage"
sudo docker compose up -d --build --remove-orphans

step "Vérification de santé (https://$DOMAIN/api/health)"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "https://$DOMAIN/api/health" > /dev/null; then
    echo "OK : l'application répond."
    sudo docker image prune -f > /dev/null
    echo "Version déployée : $CURRENT (précédente : $PREVIOUS)"
    exit 0
  fi
  sleep 2
done

echo "ÉCHEC : l'application ne répond pas après 60 s." >&2
echo "Journaux : sudo docker compose logs --tail=50 api web" >&2
echo "Retour arrière : git checkout $PREVIOUS && sudo docker compose up -d --build" >&2
exit 1
