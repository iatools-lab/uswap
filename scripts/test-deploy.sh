#!/usr/bin/env bash
# Regressions du deploiement, sans Docker ni acces a une base.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/deploy/deploy.sh"

health_of() { printf 'healthy'; }
compose_tools() {
  # Une installation neuve doit appliquer les migrations directement.
  # `migrate status` retournerait 1 sur cette meme base.
  [[ "$*" == "migrate" ]] || return 99
  return "${MIGRATE_RESULT:-0}"
}

count_fail=0
repair_migrations
[[ "$count_fail" -eq 0 ]] || exit 1
printf 'OK : migrations appliquees sur une base neuve\n'

MIGRATE_RESULT=1
if repair_migrations; then
  printf 'ERREUR : migration en echec ignoree\n' >&2
  exit 1
fi
[[ "$count_fail" -eq 1 ]] || exit 1
printf 'OK : echec de migration propage\n'

# Verifier le premier deploiement : aucune utilisation des outils avant build.
TRACE=""
run_checks() { TRACE+="checks "; }
diagnose() { printf 'Diagnostic premature\n' >&2; return 99; }
run_repairs() { printf 'Reparation prematuree\n' >&2; return 99; }
repair_env_permissions() { TRACE+="permissions "; }
repair_cookie_scheme() { TRACE+="cookies "; }
deploy_build() { TRACE+="build "; }
deploy_database() { TRACE+="database "; }
deploy_services() { TRACE+="services "; return 1; }
count_fail=0
if run_deploy; then
  printf 'ERREUR : demarrage en echec ignore\n' >&2
  exit 1
fi
[[ "$TRACE" == 'checks permissions cookies build database services ' ]] || {
  printf 'Ordre incorrect : %s\n' "$TRACE" >&2
  exit 1
}
printf 'OK : build avant migrations et arret sur echec des services\n'
