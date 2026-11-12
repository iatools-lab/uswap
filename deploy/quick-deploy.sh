#!/usr/bin/env bash
# Point d'entree historique : utilise le deploiement de production unique.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "$#" -eq 0 ]; then
  set -- --deploy
fi
exec bash "$ROOT_DIR/deploy/deploy.sh" "$@"
