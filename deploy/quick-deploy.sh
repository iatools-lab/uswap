#!/usr/bin/env bash
# =============================================================================
# uSwap — deploiement complet en UNE commande (VM Ubuntu locale ou serveur).
#
#   bash deploy/quick-deploy.sh
#
# Le script est IDEMPOTENT : on peut le relancer, il ne casse rien.
# Il ne supprime JAMAIS de volume Docker existant.
#
# Ce qu'il fait :
#   1. verifie Docker
#   2. recupere les sources (git pull, ou copie si ce n'est pas un depot)
#   3. cree deploy/.env avec des secrets aleatoires (s'il n'existe pas)
#   4. construit les images
#   5. demarre PostgreSQL
#   6. traite une migration eventuellement en echec, puis applique le schema
#   7. charge les donnees de demonstration
#   8. demarre backend + frontend
#   9. verifie de bout en bout et affiche les identifiants
# =============================================================================

set -euo pipefail

# --- Couleurs (desactivees si la sortie n'est pas un terminal) --------------
if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; N=$'\033[0m'
else
  B=""; G=""; Y=""; R=""; N=""
fi

step() { printf '\n%s==> %s%s\n' "$B" "$1" "$N"; }
ok()   { printf '  %s[OK]%s %s\n' "$G" "$N" "$1"; }
warn() { printf '  %s[ATTENTION]%s %s\n' "$Y" "$N" "$1"; }
die()  { printf '\n%s[ERREUR]%s %s\n' "$R" "$N" "$1" >&2; exit 1; }

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ENV_FILE="deploy/.env"
COMPOSE="deploy/compose.yaml"
T=(-f "$COMPOSE" --env-file "$ENV_FILE")

# Valeurs choisies une seule fois, reutilisees pour l'affichage final.
DEMO_PWD_DEFAULT='Uswap-Demo-2026!'
ADMIN_PWD_DEFAULT='Admin-Uswap-2026!'

# ---------------------------------------------------------------------------
# MODE DEMONSTRATION (VM locale / repetition) — actif par defaut.
#
# Le vrai serveur n'est PAS affecte : ce script ne modifie aucun fichier du
# depot (pas de git pull, pas de git checkout), il ne cree que deploy/.env
# localement, et le mode demo peut utiliser un projet Compose et des ports
# dedies pour ne jamais entrer en collision avec une instance reelle.
#
# Desactiver :  USWAP_DEMO=0 bash deploy/quick-deploy.sh
# ---------------------------------------------------------------------------
DEMO_MODE="${USWAP_DEMO:-1}"
DEMO_LABEL=""
DEMO_PORTS=0
if [ "$DEMO_MODE" != "0" ]; then
  DEMO_LABEL="-demo"
  DEMO_PORTS=1
fi
export COMPOSE_PROJECT_NAME="uswap${DEMO_LABEL}"

# Garde-fou : toute commande compose qui supprimerait des volumes ou une base
# est refusee. `down`, `stop` et `up` restent autorises.
compose() {
  case "$*" in
    *down*-v*|*"down --volumes"*|*reset*|*"db push"*)
      die "Commande destructive refusee par ce script : $*" ;;
  esac
  docker compose "${T[@]}" "$@"
}

# -----------------------------------------------------------------------------
step "1/9  Verification de Docker"
# -----------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "Docker n'est pas installe. Voir deploy/DEPLOYMENT_GUIDE.md, section 2."
docker info >/dev/null 2>&1 || die "Le demon Docker ne repond pas. Essayer : sudo systemctl start docker"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 absent (plugin 'docker compose')."
ok "Docker $(docker --version | sed 's/Docker version //;s/,.*//') — $(docker compose version --short)"

if [ ! -f "$COMPOSE" ]; then
  die "deploy/compose.yaml introuvable. Lancer ce script depuis la racine du depot."
fi

# -----------------------------------------------------------------------------
step "2/9  Sources"
# -----------------------------------------------------------------------------
if [ -d .git ]; then
  ok "depot Git : $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'inconnu') — $(git log --oneline -1 2>/dev/null)"
  warn "mode demonstration : aucun git pull (le depot n'est pas modifie)"
else
  warn "ce dossier n'est pas un depot Git — sources utilisees telles quelles."
fi

# Verification minimale des fichiers indispensables.
for f in frontend_new/frontend/Dockerfile \
         frontend_new/frontend/deploy/nginx.conf \
         backend_new/Dockerfile \
         backend_new/prisma/schema.prisma; do
  [ -f "$f" ] || die "fichier manquant : $f (depot incomplet)"
done
MIG_COUNT=$(find backend_new/prisma/migrations -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
[ "$MIG_COUNT" -gt 0 ] || die "aucune migration dans backend_new/prisma/migrations/"
ok "$MIG_COUNT migration(s) Prisma trouvee(s)"

# -----------------------------------------------------------------------------
step "3/9  Configuration (deploy/.env)"
# -----------------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
  ok "deploy/.env existe — conserve tel quel (aucun secret ecrase)"
else
  [ -f deploy/.env.example ] || die "deploy/.env.example introuvable"
  cp deploy/.env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  PGPASS="$(openssl rand -hex 24)"
  JWT="$(openssl rand -base64 48 | tr -d '\r\n')"
  JWTREF="$(openssl rand -base64 48 | tr -d '\r\n')"

  set_env() { # $1 = cle, $2 = valeur
    if grep -qE "^[[:space:]]*$1=" "$ENV_FILE"; then
      # '|' comme separateur : les secrets base64 contiennent '/' et '+'.
      sed -i "s|^[[:space:]]*$1=.*|$1=$2|" "$ENV_FILE"
    else
      printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
    fi
  }

  set_env POSTGRES_PASSWORD "$PGPASS"
  set_env JWT_SECRET "$JWT"
  set_env JWT_REFRESH_SECRET "$JWTREF"
  set_env ADMIN_BOOTSTRAP_PASSWORD "$ADMIN_PWD_DEFAULT"
  set_env DEMO_PASSWORD "$DEMO_PWD_DEFAULT"

  # Contexte de build : le depot a frontend_new/frontend, pas frontend/.
  [ -d frontend_new/frontend ] && set_env FRONTEND_BUILD_CONTEXT "..\/frontend_new\/frontend"
  set_env BACKEND_BUILD_CONTEXT "..\/backend_new"

  # Accessible depuis l'hote de la VM ET depuis un navigateur sur l'hote.
  set_env PUBLIC_APP_URL "http://localhost:8080"
  set_env CORS_ORIGIN "http://localhost:8080,http://127.0.0.1:8080"
  # Pas de TLS en local : un cookie Secure ne serait jamais renvoye en http.
  set_env COOKIE_SECURE "false"
  set_env COOKIE_SAMESITE "lax"
  set_env MAIL_DRIVER "console"

  # Mode demonstration : ports dedies, pour ne jamais heurter une instance
  # reelle (3000 = API de dev locale, 8080 = instance de recette).
  if [ "$DEMO_PORTS" = "1" ]; then
    set_env FRONTEND_HOST_PORT "8090"
    set_env BACKEND_HOST_PORT "3090"
  fi

  ok "deploy/.env cree (secrets aleatoires, permissions 600)"
fi

# Lecture de la configuration effective, sans jamais l'afficher en entier.
get_env() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | head -n1 | tr -d '\r"' ; }
DEMO_PWD="$(get_env DEMO_PASSWORD)"; DEMO_PWD="${DEMO_PWD:-$DEMO_PWD_DEFAULT}"
PG_USER="$(get_env POSTGRES_USER)"; PG_USER="${PG_USER:-uswap}"
PG_DB="$(get_env POSTGRES_DB)"; PG_DB="${PG_DB:-uswap}"
FE_PORT="$(get_env FRONTEND_HOST_PORT)"; FE_PORT="${FE_PORT:-8080}"
BE_PORT="$(get_env BACKEND_HOST_PORT)"; BE_PORT="${BE_PORT:-3000}"

# Mode demo : les ports sont forces, meme si un .env existait deja.
if [ "$DEMO_PORTS" = "1" ]; then
  FE_PORT="$(get_env FRONTEND_HOST_PORT)"; FE_PORT="${FE_PORT:-8090}"
fi

DB_CONTAINER="${COMPOSE_PROJECT_NAME}-db-1"
BE_CONTAINER="${COMPOSE_PROJECT_NAME}-backend-1"
FE_CONTAINER="${COMPOSE_PROJECT_NAME}-frontend-1"

psql_q() { # $1 = requete SQL, sortie brute
  docker compose "${T[@]}" exec -T db psql -U "$PG_USER" -d "$PG_DB" -tAc "$1" 2>/dev/null | tr -d '[:space:]'
}

for p in "$FE_PORT" "$BE_PORT"; do
  if ss -ltn "sport = :$p" 2>/dev/null | grep -q LISTEN; then
    OWNER="$(docker ps --format '{{.Names}} {{.Ports}}' | grep -w "$p" | head -n1 || true)"
    if [ -n "$OWNER" ]; then
      ok "port $p deja publie par un conteneur uSwap ($(echo "$OWNER" | cut -d' ' -f1))"
    else
      die "port $p deja utilise par un autre service. Changer FRONTEND_HOST_PORT / BACKEND_HOST_PORT dans $ENV_FILE"
    fi
  fi
done

# -----------------------------------------------------------------------------
step "4/9  Validation de la configuration Compose"
# -----------------------------------------------------------------------------
docker compose "${T[@]}" config >/dev/null 2>&1 \
  && ok "configuration Compose valide" \
  || die "configuration invalide. Diagnostiquer avec : docker compose -f $COMPOSE --env-file $ENV_FILE config"

# -----------------------------------------------------------------------------
step "5/9  Construction des images (quelques minutes)"
# -----------------------------------------------------------------------------
docker compose "${T[@]}" build backend
docker compose "${T[@]}" build frontend
ok "images construites"

# -----------------------------------------------------------------------------
step "6/9  Base de donnees"
# -----------------------------------------------------------------------------
docker compose "${T[@]}" up -d db
printf '  attente de PostgreSQL '
for i in $(seq 1 40); do
  status="$(docker inspect -f '{{.State.Health.Status}}' "$DB_CONTAINER" 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  printf '.'
  sleep 3
done
printf '\n'
[ "$status" = "healthy" ] || die "PostgreSQL n'est pas healthy (docker logs $DB_CONTAINER)"
ok "PostgreSQL healthy"

# -----------------------------------------------------------------------------
step "7/9  Migrations"
# -----------------------------------------------------------------------------
# Etat des migrations : une migration marquee "failed" bloque tout `deploy`
# (P3009). On l'annule proprement, SANS toucher au volume ni aux donnees.
# Aucun conteneur backend n'est demarre ici : il exige un schema a jour.

FAILED_MIG="$(psql_q "SELECT migration_name FROM \"_prisma_migrations\" WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at LIMIT 1" || true)"

if [ -n "$FAILED_MIG" ]; then
  TABLES="$(psql_q "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')" || echo 0)"
  warn "migration en echec detectee : $FAILED_MIG (tables applicatives existantes : ${TABLES:-?})"
  if [ "${TABLES:-0}" -gt 1 ] 2>/dev/null; then
    die "des tables existent deja : un 'resolve --rolled-back' risquerait un doublon.
    Verifier manuellement (psql \\dt) avant de poursuivre."
  fi
  docker compose "${T[@]}" --profile tools run --rm migrate resolve --rolled-back "$FAILED_MIG"
  ok "migration en echec annulee (aucune donnee touchee)"
fi

docker compose "${T[@]}" --profile tools run --rm migrate
ok "schema applique"

# -----------------------------------------------------------------------------
step "8/9  Donnees de demonstration"
# -----------------------------------------------------------------------------
# Seed idempotent : ne duplique rien, ne supprime rien.
if docker compose "${T[@]}" --profile tools run --rm --entrypoint sh migrate -c "npx --yes tsx prisma/seed.ts" >/tmp/uswap-seed.log 2>&1; then
  ok "seed termine ($(grep -c 'user ' /tmp/uswap-seed.log 2>/dev/null || echo 0) comptes verifies)"
else
  warn "seed en echec — voir /tmp/uswap-seed.log (le deploiement peut continuer)"
  tail -n 5 /tmp/uswap-seed.log | sed 's/^/      /'
fi

# -----------------------------------------------------------------------------
step "9/9  Demarrage et verification"
# -----------------------------------------------------------------------------
docker compose "${T[@]}" up -d backend frontend
printf '  attente des healthchecks '
for i in $(seq 1 40); do
  BE="$(docker inspect -f '{{.State.Health.Status}}' "$BE_CONTAINER" 2>/dev/null || echo starting)"
  FE="$(docker inspect -f '{{.State.Health.Status}}' "$FE_CONTAINER" 2>/dev/null || echo starting)"
  [ "$BE" = "healthy" ] && [ "$FE" = "healthy" ] && break
  printf '.'
  sleep 3
done
printf '\n'

docker compose "${T[@]}" ps

code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || echo "000"; }
BASE="http://127.0.0.1:$FE_PORT"

printf '\n  %-34s %s\n' "page d'accueil (200 attendu)"        "$(code "$BASE/")"
printf '  %-34s %s\n' "session anonyme (401 attendu)"         "$(code "$BASE/api/auth/session")"
printf '  %-34s %s\n' "route SPA /app (200 attendu)"          "$(code "$BASE/app/admin")"

LOGIN="$(curl -sS --max-time 15 -X POST "$BASE/api/auth/login" \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@upowa.org\",\"password\":\"$DEMO_PWD\"}" \
  -w '\n%{http_code}' 2>/dev/null || printf '\n000')"
LOGIN_CODE="$(printf '%s' "$LOGIN" | tail -n1)"
printf '  %-34s %s\n' "connexion admin" "$LOGIN_CODE"

IP_ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"

printf '\n%s=========================================================%s\n' "$B" "$N"
if [ "$LOGIN_CODE" = "200" ]; then
  printf '%s  DEPLOIEMENT REUSSI%s\n' "$G" "$N"
else
  printf '%s  DEPLOIEMENT PARTIEL — la connexion a echoue (%s)%s\n' "$Y" "$LOGIN_CODE" "$N"
  printf '  Diagnostiquer : docker compose -f %s --env-file %s logs --tail=60 backend\n' "$COMPOSE" "$ENV_FILE"
fi
printf '%s=========================================================%s\n' "$B" "$N"
cat <<EOF

  Adresse dans la VM      : $BASE
  Adresse depuis l'hote   : http://${IP_ADDR:-<ip-de-la-vm>}:$FE_PORT

  Compte administrateur
    e-mail                : admin@upowa.org
    mot de passe          : $DEMO_PWD

  Autres comptes de demonstration (meme mot de passe) :
    superviseur@upowa.org, chef@upowa.org, awa.nkolo@upowa.org

  Commandes utiles
    journaux backend      : docker compose ${T[*]} logs -f backend
    journaux frontend     : docker compose ${T[*]} logs -f frontend
    etat des services     : docker compose ${T[*]} ps
    arreter (sans perdre) : docker compose ${T[*]} stop

  Si l'adresse depuis l'hote ne repond pas, ouvrir les ports :
    sudo ufw allow $FE_PORT/tcp

EOF
