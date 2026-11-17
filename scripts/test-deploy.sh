#!/usr/bin/env bash
# Regressions du deploiement, sans Docker ni acces a une base.
set -Eeuo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/deploy/deploy.sh"

for path in "$BACKEND_DIR/package.json" "$BACKEND_DIR/Dockerfile" \
  "$BACKEND_DIR/prisma/schema.prisma" "$FRONTEND_DIR/package.json" \
  "$FRONTEND_DIR/Dockerfile" "$FRONTEND_DIR/deploy/nginx.conf"; do
  [[ -f "$ROOT_DIR/$path" ]] || {
    printf 'ERREUR : chemin de deploiement absent : %s\n' "$path" >&2
    exit 1
  }
done
printf 'OK : chemins backend et frontend presents\n'

compose() { printf 'test-container'; }
docker() { printf '%s' "${TEST_HEALTH:-healthy}"; }
status="$(wait_for_healthy db 0)"
[[ "$status" == healthy ]] || exit 1
TEST_HEALTH=unhealthy
if status="$(wait_for_healthy db 0)"; then
  printf 'ERREUR : base unhealthy acceptee\n' >&2
  exit 1
fi
[[ "$status" == unhealthy ]] || exit 1
unset TEST_HEALTH
printf 'OK : etat de sante separe des messages de progression\n'

saved_env_file="$ENV_FILE"
ENV_FILE="$(mktemp)"
printf '%s\n' 'PASSWORD=example#~"' "QUOTED='example#~\"'" > "$ENV_FILE"
[[ "$(read_env_value PASSWORD)" == 'example#~"' ]] || exit 1
[[ "$(read_env_value QUOTED)" == 'example#~"' ]] || exit 1
rm -f -- "$ENV_FILE"
ENV_FILE="$saved_env_file"
printf 'OK : guillemet final conserve dans les mots de passe\n'
[[ "$(login_payload 'test@example.org' 'example#~"\')" == '{"email":"test@example.org","password":"example#~\"\\"}' ]] || exit 1
printf 'OK : guillemets et antislashs echappes dans les requetes de connexion\n'

(
  read_env_value() {
    case "$1" in
      COOKIE_SECURE) printf true ;;
      REFRESH_COOKIE_NAME) printf uswap_refresh ;;
    esac
  }
  curl() {
    local header_file="" cookie="" endpoint="${!#}"
    while [ "$#" -gt 0 ]; do
      case "$1" in
        -D) header_file="$2"; shift ;;
        -H) cookie="$2"; shift ;;
      esac
      shift
    done
    if [[ "$endpoint" == */refresh ]]; then
      [[ "$cookie" == 'Cookie: uswap_refresh=initial' ]] || { printf 401; return; }
      printf 'Set-Cookie: uswap_refresh=rotated; HttpOnly; Secure\r\n' > "$header_file"
      printf 200
    else
      [[ "$cookie" == 'Cookie: uswap_refresh=rotated' ]] && printf 200 || printf 401
    fi
  }
  LOGIN_COOKIE='uswap_refresh=initial'
  count_fail=0
  count_warn=0
  check_refresh_and_logout 'http://127.0.0.1:18081' /dev/null
  [[ "$count_fail" -eq 0 && "$count_warn" -eq 0 ]] || exit 1
)
printf 'OK : cookie Secure transmis au test API local et rotation utilisee au logout\n'

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
