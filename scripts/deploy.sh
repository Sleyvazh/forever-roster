#!/usr/bin/env bash
# Déploie la dernière version de la branche main sur le serveur de production.
# Usage (sur le serveur, en tant que debian) :
#   ~/forever-roster/scripts/deploy.sh               attend que la CI GitHub du commit soit verte
#   ~/forever-roster/scripts/deploy.sh --skip-ci     déploiement d'urgence, sans vérifier la CI
set -euo pipefail

# Tout le script est dans une fonction : bash le lit en entier avant de l'exécuter.
# Sans ça, le « git merge » ci-dessous peut modifier ce fichier pendant qu'il s'exécute.
main() {
  cd "$(dirname "$0")/.."
  local skip_ci=false
  [ "${1:-}" = "--skip-ci" ] && skip_ci=true

  DOMAIN=$(grep -E '^DOMAIN=' .env | cut -d= -f2)
  step() { printf '\n\033[1;33m== %s\033[0m\n' "$1"; }

  step "Récupération du code"
  PREVIOUS=$(git rev-parse --short HEAD)
  git fetch --quiet origin main
  TARGET=$(git rev-parse origin/main)

  if [ "$skip_ci" = true ]; then
    printf '\033[1;31mCI non vérifiée (--skip-ci).\033[0m\n'
  else
    step "Vérification de la CI GitHub pour ${TARGET:0:7}"
    wait_for_ci "$TARGET"
  fi

  step "Sauvegarde de la base avant mise à jour"
  sudo /usr/local/sbin/forever-backup.sh

  step "Mise à jour du code"
  # --ff-only : refuse de déployer si le serveur a des modifications locales ou un historique divergent
  git merge --ff-only origin/main
  CURRENT=$(git rev-parse --short HEAD)
  if [ "$PREVIOUS" = "$CURRENT" ]; then
    echo "Déjà à jour ($CURRENT), reconstruction quand même."
  else
    git log --oneline "$PREVIOUS..$CURRENT"
  fi

  # Dossier des icônes monté dans Caddy : le créer nous-mêmes, sinon Docker le crée en root.
  mkdir -p icons

  step "Construction des images et redémarrage"
  sudo docker compose up -d --build --remove-orphans

  step "Vérification de santé (https://$DOMAIN/api/health)"
  for _ in $(seq 1 30); do
    # -fs : silencieux pendant les essais (un 502 est normal le temps que l'API redémarre)
    if curl -fs --max-time 3 "https://$DOMAIN/api/health" > /dev/null; then
      echo "OK : l'application répond."
      echo "Bot Discord : $(sudo docker compose logs --tail=1 --no-log-prefix bot 2>/dev/null || echo 'pas de journal')"
      sudo docker image prune -f > /dev/null
      echo "Version déployée : $CURRENT (précédente : $PREVIOUS)"
      return 0
    fi
    sleep 2
  done

  echo "ÉCHEC : l'application ne répond pas après 60 s." >&2
  echo "Journaux : sudo docker compose logs --tail=50 api web bot" >&2
  echo "Retour arrière : git checkout $PREVIOUS && sudo docker compose up -d --build" >&2
  return 1
}

# Attend que toutes les vérifications GitHub (CI, CodeQL) du commit soient terminées et réussies.
# Dépôt public : l'API GitHub répond sans jeton (60 requêtes/heure), un appel toutes les 30 s suffit.
wait_for_ci() {
  local sha="$1" repo url deadline started_wait
  url=$(git remote get-url origin)
  repo=$(printf '%s' "$url" | sed -E 's#(git@github\.com:|https://github\.com/)##; s#\.git$##')
  deadline=$(( $(date +%s) + 20 * 60 ))
  started_wait=$(date +%s)

  while :; do
    local json summary state
    if ! json=$(curl -fsS --max-time 10 -H "Accept: application/vnd.github+json" \
        ${GITHUB_TOKEN:+-H "Authorization: Bearer $GITHUB_TOKEN"} \
        "https://api.github.com/repos/$repo/commits/$sha/check-runs?per_page=100"); then
      echo "Impossible de joindre l'API GitHub. Réessaie, ou déploie avec --skip-ci en connaissance de cause." >&2
      exit 1
    fi
    summary=$(printf '%s' "$json" | python3 -c '
import json, sys
runs = json.load(sys.stdin).get("check_runs", [])
done = [r for r in runs if r["status"] == "completed"]
bad = [r["name"] for r in done if r["conclusion"] not in ("success", "skipped", "neutral")]
if not runs: print("none")
elif bad: print("failed " + ", ".join(sorted(set(bad))))
elif len(done) < len(runs): print(f"running {len(done)}/{len(runs)}")
else: print(f"ok {len(runs)}")
')
    state=${summary%% *}
    case "$state" in
      ok)
        echo "CI verte : ${summary#ok } vérification(s) réussie(s)."
        return 0 ;;
      failed)
        echo "CI en échec : ${summary#failed }. Déploiement annulé." >&2
        echo "Détail : https://github.com/$repo/commit/$sha" >&2
        exit 1 ;;
      none)
        if [ $(( $(date +%s) - started_wait )) -gt 180 ]; then
          echo "Aucune vérification GitHub trouvée pour ce commit après 3 min. Le push est-il bien parti ?" >&2
          exit 1
        fi
        echo "La CI n'a pas encore démarré, nouvel essai dans 30 s…" ;;
      running)
        echo "CI en cours (${summary#running } terminées), nouvel essai dans 30 s…" ;;
    esac
    if [ "$(date +%s)" -ge "$deadline" ]; then
      echo "La CI n'est pas terminée après 20 min. Déploiement annulé." >&2
      exit 1
    fi
    sleep 30
  done
}

main "$@"
exit
