#!/usr/bin/env bash
# =============================================================================
# uSwap — deploiement, diagnostic et reparation (une seule commande).
#
#   sudo bash deploy/deploy.sh --deploy      <= LA SEULE COMMANDE DU SUPERVISEUR
#
#   bash deploy/deploy.sh --check            # controle seul, ne modifie rien
#   bash deploy/deploy.sh --diagnose         # diagnostic detaille, ne modifie rien
#   sudo bash deploy/deploy.sh --repair      # reparations ciblees sures
#   bash deploy/deploy.sh --help             # affiche ce document
#
# =============================================================================
# 0. LA COMMANDE UNIQUE (ce que fait le superviseur)
# =============================================================================
#
#   sudo bash deploy/deploy.sh --deploy
#
# Cette commande realise, dans cet ordre, SANS intervention :
#   1. controles bloquants (root, outils, sources, deploy/.env, Docker)
#   2. diagnostic complet de l'existant
#   3. reparations sures (permissions, base, migrations, bootstrap, Apache)
#   4. reconstruction des images backend et frontend
#   5. PostgreSQL + migrations + referentiel
#   6. demarrage backend/frontend avec attente des sondes de sante
#   7. tests HTTP (accueil, API anonyme, route SPA)
#   8. Apache : VirtualHost installe/complete, configtest, reload si valide
#   9. verification des DEUX parcours de connexion
#  10. rapport final avec code de sortie fiable
#
# Un seul echec reel arrete le script avec un code parlant (voir §7).
# Les avertissements n'arretent pas : ils sont listes dans le rapport.
#
# =============================================================================
# 1. LES QUATRE MODES
# =============================================================================
#
# --check      Controle tout (sources, .env, Docker, ports, etat des services)
#              et affiche un rapport. Sortie 1 des la premiere anomalie.
#
# --diagnose   Controle + diagnostics detailles : conteneurs, journaux, base,
#              migrations, routeurs HTTP, parcours de connexion e-mail/mot de
#              passe et Google. Aucune modification.
#
# --repair     Controle, puis applique UNIQUEMENT des reparations sures :
#              permissions de deploy/.env, dossiers d'attente, base absente
#              (CREATE DATABASE uniquement), migrations manquantes, referentiel
#              (bootstrap idempotent), permissions du volume de pieces jointes,
#              divergence du VirtualHost Apache. Jamais de volume supprime,
#              jamais de base reinitialisee, jamais de secret regenere.
#
# --deploy     Controle, diagnostic, reparations sures, build, PostgreSQL,
#              migrations, bootstrap, demarrage, Apache, tests finaux, et
#              verification des DEUX parcours de connexion.
#
# Le script est IDEMPOTENT : on peut le relancer. Il n'ecrase jamais
# deploy/.env, ne supprime aucun volume, ne cree aucun nouveau secret.
#
# =============================================================================
# 2. ARCHITECTURE REELLE (fichiers du depot)
# =============================================================================
#
#   Internet
#     |  HTTPS (443)
#     v
#   Apache de l'hote  --> 127.0.0.1:${FRONTEND_HOST_PORT} --> conteneur frontend
#     (deploy/apache/uswap.conf)                              (Nginx :80)
#                                                              |-- /       -> index.html
#                                                              |-- /api/x  -> backend:3000/x
#                                                              |-- /api-docs -> backend/docs
#                                                                   |
#                                                                   v
#                                                            db:5432 (PostgreSQL 16)
#
#   Services Compose (projet « uswap », deploy/compose.yaml) :
#     db         postgres:16-alpine    volume uswap-pgdata    aucun port publie
#     backend    NestJS  127.0.0.1:${BACKEND_HOST_PORT}       volume uswap-uploads
#     frontend   nginx:1.27-alpine  127.0.0.1:${FRONTEND_HOST_PORT}
#     migrate    profil « tools »    prisma migrate deploy (manuel)
#     bootstrap  profil « tools »    referentiel + super administrateur
#
#   Dockerfiles :
#     backend_new/Dockerfile            build tsc -> dist/main.js
#     frontend_new/frontend/Dockerfile  build Vite -> Nginx + proxy /api
#     frontend_new/frontend/deploy/nginx.conf   proxy /api et /api-docs
#
#   En production, tout vient de deploy/.env : les fichiers backend_new/.env et
#   frontend_new/frontend/.env servent seulement au developpement local.
#
# =============================================================================
# 3. VARIABLES LUES DANS deploy/.env (aucune n'est ecrite par ce script)
# =============================================================================
#
#   POSTGRES_DB / POSTGRES_USER / POSTGRES_PASSWORD   base dediee uSwap
#   JWT_SECRET / JWT_REFRESH_SECRET                   secrets de session
#   ADMIN_BOOTSTRAP_PASSWORD                          compte ADMIN a secourir
#   SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD            super administrateur
#   PUBLIC_APP_URL / CORS_ORIGIN                      URL publique reelle
#   GOOGLE_CLIENT_ID                                  OAuth Google (public)
#   GOOGLE_ALLOWED_DOMAINS                            domaines autorises
#   FRONTEND_HOST_PORT / BACKEND_HOST_PORT            ports lies a 127.0.0.1
#
# =============================================================================
# 4. PARCOURS DE CONNEXION VERIFIES
# =============================================================================
#
#   a) E-mail + mot de passe (contre le 502 historiquement signale) :
#      - POST /api/auth/login/superadmin avec le compte super administrateur,
#        via le proxy Nginx du conteneur ET Apache s'il est installe ;
#      - le code 502 est bloque et diagnostique (cause ramenee par le script) ;
#      - la session obtenue sert ensuite a rafraichir et a se deconnecter, ce
#        qui prouve que le cookie HttpOnly est bien pose et relu.
#      Aucune tentative de connexion par defaut si SUPERADMIN_PASSWORD
#      ressemble encore a un modele ou contient « Demo » : le script ne
#      verrouille pas un compte reel avec de faux essais.
#
#   b) Google : verification de NON-REGRESSION uniquement. Aucun appel a
#      Google n'est fait et aucune configuration n'est modifiee.
#        - GOOGLE_CLIENT_ID present et au bon format (regression detectee si
#          un environnement reinitialise l'a vide) ;
#        - meme valeur compilee dans le bundle du frontend (VITE_GOOGLE_CLIENT_ID)
#          sinon le bouton disparait alors que le backend est configure ;
#        - le backend accepte le parcours (jeton bidon -> 401 metier, jamais
#          400 « non configure », jamais 500, jamais 502) ;
#        - GOOGLE_ALLOWED_DOMAINS couvre le domaine du compte super admin.
#
# =============================================================================
# 5. CE QUE LE SCRIPT NE FAIT JAMAIS
# =============================================================================
#
#   docker compose down -v   /  --volumes   /  prune  /  migrate reset
#   prisma migrate dev       /  db push     /  suppression de base
#   Ecriture d'un secret dans deploy/.env   /  renommage d'une variable
#   Rechargement d'Apache si configtest echoue  /  redemarrage des autres
#   applications du serveur.
#
# =============================================================================
# 6. CODES DE SORTIE
# =============================================================================
#
#   0  tout est bon
#   1  anomalies bloquantes ou operation echouee (cas general)
#   2  mauvaise utilisation (option inconnue, mode absent)
#   3  prerequis serveur insuffisant (root, Docker, outils, sources)
#   4  deploy/.env absent, invalide ou incomplet (jamais complete par le script)
#   5  port occupe / chaine HTTP (Nginx, Apache) ou build en echec
#   6  connexion e-mail + mot de passe en echec (502 ou refus applicatif)
#   7  non-regression Google en echec
#
# Le premier domaine en cause determine le code (login > google > config >
# reseau > prerequis). `sudo bash deploy/deploy.sh --deploy; echo $?` suffit
# donc a savoir ou regarder.
#
# =============================================================================
# 7. EXEMPLES
# =============================================================================
#
#   sudo bash deploy/deploy.sh --deploy          # la commande du superviseur
#   bash deploy/deploy.sh --check                # avant un git pull
#   bash deploy/deploy.sh --diagnose | tee diag.txt
#   sudo bash deploy/deploy.sh --repair          # apres un 502 signale
#
# =============================================================================

set -Eeuo pipefail

# =============================================================================
#  SECTION A — CONSTANTES ET ETAT
# =============================================================================

# Racine du depot = dossier parent de deploy/. Le script est concu pour etre
# lance (`bash deploy/deploy.sh`), jamais source ; si un harness le source,
# cette resolution reste correcte tant que le fichier est dans deploy/.
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Garde-fou : si le dossier deploy/ n'est pas trouve (fichier copie ailleurs),
# on refuse de continuer plutot que d'operer sur la racine du systeme.
if [ ! -f "$ROOT_DIR/deploy/compose.yaml" ]; then
  if [ -f "$(pwd)/deploy/compose.yaml" ]; then
    ROOT_DIR="$(pwd)"
  else
    printf '%s[ERREUR]%s racine du depot introuvable (deploy/compose.yaml).\n' "$R" "$N" >&2
    printf '  Lancer depuis le depot : sudo bash deploy/deploy.sh --deploy\n' >&2
    exit 2
  fi
fi
cd "$ROOT_DIR"

COMPOSE_FILE="deploy/compose.yaml"
ENV_FILE="deploy/.env"
ENV_TEMPLATE="deploy/.env.example"
APACHE_CONF="deploy/apache/uswap.conf"
APACHE_TARGET="/etc/apache2/sites-available/uswap.conf"
PROJECT_NAME="uswap"
COMPOSE=(-f "$COMPOSE_FILE" --env-file "$ENV_FILE")

BACKEND_DIR="backend_new"
FRONTEND_DIR="frontend_new/frontend"

# Delais (secondes). Surchargeables pour un serveur lent.
WAIT_DB_TIMEOUT="${USWAP_WAIT_DB_TIMEOUT:-120}"
WAIT_BACKEND_TIMEOUT="${USWAP_WAIT_BACKEND_TIMEOUT:-150}"
WAIT_FRONTEND_TIMEOUT="${USWAP_WAIT_FRONTEND_TIMEOUT:-90}"

MODE=""
FORCE_BUILD=0
ACTION_COUNT=0
ACTION_LIST=()
CONNECTION_CHECKS_RUN=0

# Journal d'execution : pleine trace, chmod 600 (il peut citer des erreurs
# applicatives, jamais un secret). Repli sur /tmp si le depot est en lecture.
LOG_DIR="var/logs/deploy"
mkdir -p "$LOG_DIR" 2>/dev/null || true
[ -w "$LOG_DIR" ] || LOG_DIR="/tmp"
LOG_FILE="$LOG_DIR/uswap-$(date +%Y%m%d-%H%M%S).log"
: >"$LOG_FILE" 2>/dev/null || true

# --- Couleurs : desactivees si la sortie n'est pas un terminal ---------------
if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; C=$'\033[36m'; N=$'\033[0m'
else
  B=""; G=""; Y=""; R=""; C=""; N=""
fi

# =============================================================================
#  SECTION B — AFFICHAGE, ERREURS ET COMPTEURS
# =============================================================================

step() { printf '\n%s==> %s%s\n' "$B" "$1" "$N"; }
sub()  { printf '\n  %s-- %s%s\n' "$C" "$1" "$N"; }
ok()   { printf '  %s[OK]%s %s\n' "$G" "$N" "$1"; }
warn() { printf '  %s[ATTENTION]%s %s\n' "$Y" "$N" "$1"; }
bad()  { printf '  %s[ERREUR]%s %s\n' "$R" "$N" "$1"; }
info() { printf '        %s\n' "$1"; }

count_ok=0
count_warn=0
count_fail=0

pass() { ok "$1"; count_ok=$((count_ok + 1)); }
soft() { warn "$1"; count_warn=$((count_warn + 1)); }

# `fail` signale une anomalie bloquante SANS arreter le controle : le
# diagnostic continue pour ramener la cause complete.
fail() {
  bad "$1"
  count_fail=$((count_fail + 1))
}

# `die` arrete le script avec un code de sortie fiable.
die() {
  printf '\n%s[ARRET]%s %s\n' "$R" "$N" "$1" >&2
  printf '  Journal : %s\n' "$LOG_FILE" >&2
  exit 1
}

# Codes de sortie (fiables, documentes en tete de fichier)
#   0  tout est bon
#   1  anomalies bloquantes detectees ou operation echouee
#   2  mauvaise utilisation (option inconnue, mode absent)
#   3  prerequis serveur insuffisant (root, Docker, outils)
#   4  deploy/.env absent, invalide ou incomplet (jamais complete par le script)
#   5  port occupe / chaine HTTP (Nginx, Apache) en echec
#   6  connexion e-mail + mot de passe en echec (502 ou refus applicatif)
#   7  non-regression Google en echec
#
# Un domaine marque (prereq, config, network, login, google) determine le code
# retourne par `failure_exit_code` : le superviseur sait ainsi OU regarder.
EXIT_PREREQ=0
EXIT_CONFIG=0
EXIT_NETWORK=0
EXIT_LOGIN=0
EXIT_GOOGLE=0

mark_prereq() { EXIT_PREREQ=1; }
mark_config() { EXIT_CONFIG=1; }
mark_network() { EXIT_NETWORK=1; }
mark_login() { EXIT_LOGIN=1; }
mark_google() { EXIT_GOOGLE=1; }

failure_exit_code() {
  if [ "$count_fail" -eq 0 ]; then
    printf '0'
  elif [ "$EXIT_LOGIN" -eq 1 ]; then
    printf '6'
  elif [ "$EXIT_GOOGLE" -eq 1 ]; then
    printf '7'
  elif [ "$EXIT_CONFIG" -eq 1 ]; then
    printf '4'
  elif [ "$EXIT_NETWORK" -eq 1 ]; then
    printf '5'
  elif [ "$EXIT_PREREQ" -eq 1 ]; then
    printf '3'
  else
    printf '1'
  fi
}

# =============================================================================
#  SECTION C — HELPERS
# =============================================================================

have() { command -v "$1" >/dev/null 2>&1; }

# Signale une interruption inattendue, SANS quitter : `set -e` fait deja
# sortir le shell, et un `exit` dans le trap tuerait aussi les sous-shells
# des commandes `$(...) || true` — c'est exactement ce qui coupait le script
# quand le reseau echouait (verifie en test). `return 0` laisse donc la
# gestion d'erreur au shell, qui sort avec le VRAI code.
on_error() {
  local status=$?
  [ "$status" -ne 0 ] || return 0
  # Uniquement le corps principal (pas les `return 1` attendus des fonctions).
  if [ "${#FUNCNAME[@]}" -le 2 ]; then
    printf '\n%s[INTERROMPU]%s ligne %s (code %s)\n' "$R" "$N" "${1:-?}" "$status" >&2
    printf '  Journal : %s\n' "$LOG_FILE" >&2
    printf '  Relancer avec : sudo bash deploy/deploy.sh --diagnose\n' >&2
  fi
  return 0
}
trap 'on_error $LINENO' ERR

# Executeur de `docker compose`. Refuse par CONSTRUCTION toute commande
# destructrice : c'est un garde-fou, pas une recommandation.
compose() {
  local joined="$*"
  case "$joined" in
    *"down -v"*|*"down --volumes"*|*"--volumes"*|*" system prune"*|*" volume "*prune*|*"migrate reset"*|*"migrate dev"*|*"db push"*|*"dropdb"*|*"DROP DATABASE"*)
      die "Commande destructive refusee : docker compose $joined"
      ;;
  esac
  docker compose "${COMPOSE[@]}" "$@"
}

# Executeur de `docker compose run --rm` (profils tools).
compose_tools() {
  compose --profile tools run --rm "$@"
}

# Valeur brute d'une cle de deploy/.env : dernier gagnant, guillemets retires.
read_env_value() {
  local key="$1"
  local default_value="${2:-}"
  local value
  value="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$ENV_FILE" 2>/dev/null | tail -n 1 | cut -d= -f2- || true)"
  value="${value%\"}"
  value="${value#\"}"
  value="${value%\'}"
  value="${value#\'}"
  if [ -n "$value" ]; then
    printf '%s' "$value"
  else
    printf '%s' "$default_value"
  fi
}

# TRUE logiques acceptes par Compose.
is_true() {
  case "${1:-}" in
    true|TRUE|True|1|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

# Normalise une URL (sans barre oblique finale) pour les comparaisons.
norm_url() {
  local url="${1:-}"
  printf '%s' "${url%/}"
}

# Code HTTP (000 si injoignable).
#
# Piege corrige : sur echec reseau, curl ecrit deja « 000 » sur stdout ET
# sort en erreur, donc `|| echo 000` produisait « 000000 ». On ne capture que
# la sortie, et on normalise sur une valeur de 3 chiffres.
http_code() {
  local out
  out="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null || true)"
  out="$(printf '%s' "$out" | tr -cd '0-9' | tail -c 3)"
  printf '%s' "${out:-000}"
}

# Normalise un code HTTP capture comme le fait http_code (3 chiffres).
norm_code() {
  local out
  out="$(printf '%s' "${1:-}" | tr -cd '0-9' | tail -c 3)"
  printf '%s' "${out:-000}"
}

# Corps d'une reponse (silencieux en cas d'echec reseau).
http_body() {
  curl -sS --max-time 10 "$@" 2>/dev/null || true
}

# Extrait un champ JSON scalaire d'une reponse.
json_string() {
  local body="$1"
  local key="$2"
  printf '%s' "$body" | sed -n "s/.*\"${key}\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" | head -n 1
}

# Attend que le service Compose soit `healthy` (ou `running` si pas de sonde).
wait_for_healthy() {
  local service="$1"
  local timeout="$2"
  local id wait_s=2 elapsed=0 status="unknown"

  # Compose ne donne pas le nom du conteneur : `ps -q` le resout, meme si le
  # nommage a change (`uswap-db-1`, `uswap_db_1`...).
  id="$(compose ps -q "$service" 2>/dev/null | head -n 1 || true)"
  if [ -z "$id" ]; then
    printf '  %s : conteneur introuvable\n' "$service"
    return 1
  fi
  printf '  attente de %s (%ss max) ' "$service" "$timeout"
  for _ in $(seq 1 60); do
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || true)"
    status="${status:-unknown}"
    case "$status" in
      healthy|running) printf '\n'; printf '%s' "$status"; return 0 ;;
      exited|dead)     printf '\n'; printf '%s' "$status"; return 1 ;;
    esac
    if [ "$elapsed" -ge "$timeout" ]; then
      printf '\n'; printf '%s' "$status"; return 1
    fi
    printf '.'
    sleep "$wait_s"
    elapsed=$((elapsed + wait_s))
  done
  printf '\n%s' "$status"
  return 1
}

health_of() {
  local service="$1"
  local id
  id="$(compose ps -q "$service" 2>/dev/null | head -n 1 || true)"
  if [ -z "$id" ]; then
    printf 'absent'
    return
  fi
  docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null || printf 'unknown'
}

# Affiche la fin du journal d'un service, indente, pour que la cause d'un
# echec soit visible dans le rapport et pas seulement dans les logs Docker.
last_logs() {
  local service="$1"
  local lines="${2:-60}"
  printf '\n  --- %s (dernieres %s lignes) ---\n' "$service" "$lines"
  compose logs --tail="$lines" "$service" 2>/dev/null | sed 's/^/        /' || true
}

# =============================================================================
#  SECTION D — ARGUMENTS
# =============================================================================

usage() {
  # Le mode d'emploi est TOUT l'en-tete : les lignes commentees qui precedent
  # la premiere ligne de code (`set -Eeuo pipefail`). On le calcule, on ne
  # code pas un numero de ligne en dur — il etait faux apres chaque ajout.
  local first_code
  first_code="$(awk '/^set -Eeuo pipefail$/ {print NR; exit}' "${BASH_SOURCE[0]}")"
  [ -n "$first_code" ] || first_code=1
  head -n "$((first_code - 1))" "${BASH_SOURCE[0]}" | tail -n +2 | sed 's/^# \{0,1\}//'
  exit 0
}

parse_args() {
  [ "$#" -gt 0 ] || {
    usage
  }
  for arg in "$@"; do
    case "$arg" in
      --deploy)     MODE="deploy"; FORCE_BUILD=1 ;;
      --check)      MODE="check" ;;
      --diagnose)   MODE="diagnose" ;;
      --repair)     MODE="repair" ;;
      --rebuild)    FORCE_BUILD=1 ;;
      --help|-h)    usage ;;
      *)
        printf '%s[ERREUR]%s option inconnue : %s\n\n' "$R" "$N" "$arg" >&2
        printf 'Modes : --check, --diagnose, --repair, --deploy\n' >&2
        printf 'Autres : --rebuild, --help\n' >&2
        exit 2
        ;;
    esac
  done
  [ -n "$MODE" ] || {
    printf '%s[ERREUR]%s choisir un mode : --check, --diagnose, --repair ou --deploy\n' "$R" "$N" >&2
    exit 2
  }
  start_logging
}

# Trace complete de l'execution dans $LOG_FILE : stdout ET stderr, sans
# supprimer l'affichage (le superviseur voit la meme chose). Le journal est
# ferme par le shell a la sortie ; il ne contient aucun secret affiche.
start_logging() {
  if [ "$LOG_DIR" != "/tmp" ] && [ -w "$LOG_DIR" ]; then
    chmod 700 "$LOG_DIR" 2>/dev/null || true
  fi
  : >"$LOG_FILE" 2>/dev/null || return 0
  chmod 600 "$LOG_FILE" 2>/dev/null || true
  exec > >(tee -a "$LOG_FILE") 2>&1
}

# Rend `die` explicite sur le domaine de l'echec pour le code de sortie.
# `fail_domain <domaine> <message>` remplace `fail` quand la nature est connue.
fail_domain() {
  local domain="$1"
  shift
  case "$domain" in
    prereq)  mark_prereq ;;
    config)  mark_config ;;
    network) mark_network ;;
    login)   mark_login ;;
    google)  mark_google ;;
  esac
  fail "$*"
}

# =============================================================================
#  SECTION E — CONTROLE DES PREREQUIS (--check)
# =============================================================================

check_root() {
  if [ "$(id -u)" -eq 0 ]; then
    pass "execution en root"
  elif [ "$MODE" = "check" ] || [ "$MODE" = "diagnose" ]; then
    soft "script lance sans sudo : Docker peut refuser l'acces (lecture seule OK)"
  else
    fail_domain prereq "le deploiement exige root : sudo bash deploy/deploy.sh --$MODE"
  fi
}

check_tools() {
  local missing=()
  local tool
  for tool in docker curl awk sed grep; do
    have "$tool" || missing+=("$tool")
  done
  if [ "${#missing[@]}" -eq 0 ]; then
    pass "outils presents (docker, curl, awk, sed, grep)"
  else
    fail_domain prereq "outils absents : ${missing[*]}"
    case " ${missing[*]} " in
      *" docker "*) info "installer Docker : https://docs.docker.com/engine/install/ubuntu/" ;;
    esac
    info "Ubuntu : apt-get install -y curl (awk/sed/grep sont fournis par la base)"
  fi
  have openssl && pass "openssl present" || soft "openssl absent (aucune generation de secret par ce script, sans effet)"
  have ss && pass "ss present (controle des ports)" || soft "ss absent : les ports ne seront pas controles"
}

check_sources() {
  local path
  if [ ! -f "$COMPOSE_FILE" ]; then
    fail_domain prereq "deploy/compose.yaml introuvable (lancer depuis le depot uSwap)"
    return
  fi
  for path in \
    "$ENV_TEMPLATE" \
    "$BACKEND_DIR/Dockerfile" \
    "$BACKEND_DIR/package.json" \
    "$BACKEND_DIR/package-lock.json" \
    "$BACKEND_DIR/prisma/schema.prisma" \
    "$BACKEND_DIR/prisma/bootstrap.ts" \
    "$BACKEND_DIR/src/main.ts" \
    "$BACKEND_DIR/src/auth/auth.controller.ts" \
    "$FRONTEND_DIR/Dockerfile" \
    "$FRONTEND_DIR/package.json" \
    "$FRONTEND_DIR/package-lock.json" \
    "$FRONTEND_DIR/deploy/nginx.conf" \
    "$FRONTEND_DIR/index.html" \
    "$APACHE_CONF"; do
    if [ -f "$path" ]; then
      pass "source : $path"
    else
      fail_domain prereq "fichier manquant : $path (depot incomplet ou contexte de build faux)"
    fi
  done

  local mig_count
  mig_count="$(find "$BACKEND_DIR/prisma/migrations" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
  if [ "${mig_count:-0}" -gt 0 ]; then
    pass "migrations Prisma versionnees : $mig_count"
  else
    fail_domain prereq "aucune migration dans $BACKEND_DIR/prisma/migrations/"
  fi

  # Contexte de build resolu : c'est la panne historique (le contexte pointait
  # vers un dossier sans Dockerfile, Compose construisait une image vide).
  local ctx_backend ctx_frontend
  ctx_backend="$(cd deploy && cd "${BACKEND_BUILD_CONTEXT:-../backend_new}" 2>/dev/null && pwd || true)"
  ctx_frontend="$(cd deploy && cd "${FRONTEND_BUILD_CONTEXT:-../frontend_new/frontend}" 2>/dev/null && pwd || true)"
  if [ -n "$ctx_backend" ] && [ -f "$ctx_backend/Dockerfile" ]; then
    pass "contexte backend : ${ctx_backend#$ROOT_DIR/} (Dockerfile present)"
  else
    fail_domain prereq "contexte backend introuvable ou sans Dockerfile (${ctx_backend:-vide})"
  fi
  if [ -n "$ctx_frontend" ] && [ -f "$ctx_frontend/Dockerfile" ]; then
    pass "contexte frontend : ${ctx_frontend#$ROOT_DIR/} (Dockerfile present)"
  else
    fail_domain prereq "contexte frontend introuvable ou sans Dockerfile (${ctx_frontend:-vide})"
  fi
}

check_docker() {
  if ! have docker; then
    fail_domain prereq "Docker n'est pas installe : https://docs.docker.com/engine/install/ubuntu/"
    return
  fi
  if ! docker info >/dev/null 2>&1; then
    fail_domain prereq "le demon Docker ne repond pas (sudo systemctl start docker)"
    return
  fi
  if docker compose version >/dev/null 2>&1; then
    pass "Docker $(docker --version | sed 's/Docker version //;s/,.*//') / Compose $(docker compose version --short 2>/dev/null || echo '?')"
  else
    fail_domain prereq "Docker Compose v2 absent (plugin 'docker compose')"
  fi

  # Aucune image de base en cache : le premier build telecharge plusieurs
  # centaines de Mo. Signale sans bloquer.
  local base_count
  # `grep -c` sort en 1 quand il ne trouve rien : `|| true` est indispensable
  # sous `set -e`, et `tr` nettoie les espaces eventuels.
  base_count="$(docker image ls --format '{{.Repository}}' 2>/dev/null | grep -cE '^(node|postgres|nginx)$' || true)"
  base_count="$(printf '%s' "${base_count:-0}" | tr -cd '0-9')"
  if [ "${base_count:-0}" -eq 0 ]; then
    soft "aucune image de base en cache : le premier build telecharge ~1 Go"
  fi
}

# --- Configuration deploy/.env ----------------------------------------------

check_env_file() {
  if [ -f "$ENV_FILE" ]; then
    pass "deploy/.env present"
  else
    if [ "$MODE" = "check" ] || [ "$MODE" = "diagnose" ]; then
      fail_domain config "deploy/.env absent : cp $ENV_TEMPLATE $ENV_FILE puis renseigner les valeurs"
    else
      fail_domain config "deploy/.env absent : ce script ne cree pas de secret. Lancer : cp $ENV_TEMPLATE $ENV_FILE && chmod 600 $ENV_FILE"
      info "puis renseigner POSTGRES_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET,"
      info "ADMIN_BOOTSTRAP_PASSWORD, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD,"
      info "PUBLIC_APP_URL, CORS_ORIGIN et GOOGLE_CLIENT_ID."
    fi
    return 1
  fi

  local perms
  perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')"
  if [ "$perms" = "600" ]; then
    pass "permissions deploy/.env : 600"
  elif [ "$MODE" = "repair" ] || [ "$MODE" = "deploy" ]; then
    if chmod 600 "$ENV_FILE" 2>/dev/null; then
      ACTION_COUNT=$((ACTION_COUNT + 1))
      ACTION_LIST+=("deploy/.env : permissions 600 appliquees (etait $perms)")
      pass "permissions deploy/.env corrigees : 600 (etait $perms)"
    else
      soft "permissions deploy/.env : $perms (chmod impossible)"
    fi
  else
    soft "permissions deploy/.env : $perms (attendu 600) : sudo chmod 600 $ENV_FILE"
  fi

  if grep -qiE '^[[:space:]]*ENABLE_WEB_PUSH[[:space:]]*=[[:space:]]*(true|1|yes)' "$ENV_FILE"; then
    soft "ENABLE_WEB_PUSH=true dans deploy/.env : le compose force DISABLE_WEB_PUSH=true, les notifications Web restent desactivees"
  else
    pass "notifications Web Push desactivees (conforme a la consigne)"
  fi

  if grep -qiE '^[[:space:]]*LEAVE_SYNC_ENABLED[[:space:]]*=[[:space:]]*(true|1|yes)' "$ENV_FILE"; then
    soft "LEAVE_SYNC_ENABLED=true dans deploy/.env mais compose.yaml ne transmet aucune variable LEAVE_SYNC_*"
  fi
  return 0
}

# Une valeur est un modele si elle est vide, marquee CHANGER-* ou reste
# l'exemple du depot.
is_placeholder() {
  local value="$1"
  value="$(printf '%s' "$value" | tr -d '[:space:]')"
  [ -z "$value" ] && return 0
  case "$value" in
    *CHANGER-*|*CHANGE_ME*|*change-me*|*example.org*|*replace-with*) return 0 ;;
  esac
  return 1
}

check_env_values() {
  local key value status
  # Secrets obligatoires : vide ou modele = le service Compose refuse de
  # demarrer (`:?definir ...` dans compose.yaml).
  for key in POSTGRES_PASSWORD JWT_SECRET JWT_REFRESH_SECRET ADMIN_BOOTSTRAP_PASSWORD; do
    value="$(read_env_value "$key")"
    if is_placeholder "$value"; then
      fail_domain config "$key non renseigne dans deploy/.env (valeur modele ou vide)"
    elif [ "${#value}" -lt 16 ]; then
      soft "$key court (${#value} caracteres) : 32 recommandes"
    else
      pass "$key renseigne (${#value} caracteres)"
    fi
  done

  if [ "$(read_env_value POSTGRES_PASSWORD)" = "$(read_env_value JWT_SECRET)" ]; then
    fail_domain config "POSTGRES_PASSWORD et JWT_SECRET identiques : utiliser deux secrets distincts"
  else
    pass "secrets distincts"
  fi

  for key in SUPERADMIN_EMAIL SUPERADMIN_PASSWORD; do
    value="$(read_env_value "$key")"
    if is_placeholder "$value"; then
      fail_domain config "$key non renseigne dans deploy/.env"
    else
      pass "$key renseigne"
    fi
  done

  if printf '%s' "$(read_env_value SUPERADMIN_PASSWORD)" | grep -q "Demo"; then
    soft "SUPERADMIN_PASSWORD contient « Demo » : changer ce mot de passe avant la production"
  fi

  # URL publiques
  local public_url cors_origin domain
  public_url="$(norm_url "$(read_env_value PUBLIC_APP_URL)")"
  cors_origin="$(norm_url "$(read_env_value CORS_ORIGIN)")"
  if [ -z "$public_url" ]; then
    fail_domain config "PUBLIC_APP_URL vide (liens d'invitation et origine de session)"
  else
    case "$public_url" in
      https://*) pass "PUBLIC_APP_URL=$public_url (HTTPS)" ;;
      http://*)  soft "PUBLIC_APP_URL=$public_url : sans HTTPS la geolocalisation et le cookie Secure sont refuses" ;;
      *)         fail_domain config "PUBLIC_APP_URL invalide : $public_url" ;;
    esac
  fi
  if [ "$public_url" != "$cors_origin" ]; then
    soft "CORS_ORIGIN ($cors_origin) different de PUBLIC_APP_URL ($public_url)"
  else
    pass "CORS_ORIGIN identique a PUBLIC_APP_URL"
  fi

  domain="$(printf '%s' "$public_url" | sed 's|https\?://||;s|/.*||;s|:.*||')"
  PUBLIC_DOMAIN="$domain"

  # Cookie : derive de HTTPS, pour signaler une incoherence precise.
  local cookie_secure
  cookie_secure="$(read_env_value COOKIE_SECURE true)"
  case "$public_url" in
    https://*) is_true "$cookie_secure" && pass "COOKIE_SECURE=$cookie_secure coherent avec HTTPS" \
                 || soft "COOKIE_SECURE=$cookie_secure avec HTTPS : cookie de session non protege" ;;
    http://*)  is_true "$cookie_secure" && soft "COOKIE_SECURE=true en HTTP : le navigateur ignorera le cookie de session" \
                 || pass "COOKIE_SECURE=$cookie_secure coherent avec HTTP (recette uniquement)" ;;
  esac

  local samesite
  samesite="$(read_env_value COOKIE_SAMESITE lax)"
  if [ "$samesite" = "lax" ]; then
    pass "COOKIE_SAMESITE=lax (meme origine via le proxy)"
  else
    soft "COOKIE_SAMESITE=$samesite : verifier que le frontend et l'API restent sur la meme origine"
  fi

  # Google : format de l'identifiant. Le seul numero de projet n'est pas un
  # identifiant client (erreur « client ID not found »).
  GOOGLE_ID="$(read_env_value GOOGLE_CLIENT_ID)"
  if [ -z "$GOOGLE_ID" ]; then
    soft "GOOGLE_CLIENT_ID vide : bouton « Se connecter avec Google » masque"
  elif printf '%s' "$GOOGLE_ID" | grep -qE '^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$'; then
    pass "GOOGLE_CLIENT_ID au format attendu (client OAuth Web)"
  elif printf '%s' "$GOOGLE_ID" | grep -qE '^[0-9]+$'; then
    fail_domain config "GOOGLE_CLIENT_ID = numero de PROJET ($GOOGLE_ID), pas un identifiant client : copier la ligne « ID client » complete"
  else
    soft "GOOGLE_CLIENT_ID inattendu : $GOOGLE_ID (attendu ...apps.googleusercontent.com)"
  fi

  # Le domaine a comparer est celui du COMPTE super administrateur (le sien
  # doit etre autorise par Google), pas celui du site : le site peut tres
  # bien s'appeler uswap.upowa.org alors que les comptes sont @upowa.org.
  GOOGLE_DOMAINS="$(read_env_value GOOGLE_ALLOWED_DOMAINS upowa.org)"
  local admin_domain
  admin_domain="$(read_env_value SUPERADMIN_EMAIL)"
  admin_domain="$(printf '%s' "$admin_domain" | sed 's/.*@//' | tr 'A-Z' 'a-z')"
  if [ -n "$GOOGLE_ID" ] && [ -n "$admin_domain" ]; then
    case ",${GOOGLE_DOMAINS}," in
      *",${admin_domain},"*) pass "domaine du super admin (${admin_domain}) autorise par GOOGLE_ALLOWED_DOMAINS" ;;
      *) soft "le compte $(read_env_value SUPERADMIN_EMAIL) sera refuse par Google : « ${admin_domain} » absent de GOOGLE_ALLOWED_DOMAINS=$GOOGLE_DOMAINS" ;;
    esac
  fi

  # Ports lies a 127.0.0.1
  FRONTEND_PORT="$(read_env_value FRONTEND_HOST_PORT 8080)"
  BACKEND_PORT="$(read_env_value BACKEND_HOST_PORT 3000)"
  for pair in "FRONTEND_HOST_PORT:$FRONTEND_PORT" "BACKEND_HOST_PORT:$BACKEND_PORT"; do
    key="${pair%%:*}"; value="${pair#*:}"
    case "$value" in
      ''|*[!0-9]*) fail_domain config "$key doit etre un numero de port (valeur : '$value')" ;;
      *) if [ "$value" -ge 1 ] && [ "$value" -le 65535 ]; then
           pass "$key=$value"
         else
           fail_domain config "$key hors plage 1-65535 ($value)"
         fi ;;
    esac
  done
  if [ "$FRONTEND_PORT" = "$BACKEND_PORT" ]; then
    fail_domain config "FRONTEND_HOST_PORT et BACKEND_HOST_PORT identiques ($FRONTEND_PORT)"
  fi
  BIND_ADDRESS="127.0.0.1"
}

check_ports() {
  if ! have ss; then
    soft "ss absent : ports non verifies"
    return
  fi
  local port listeners holder
  for port in "$FRONTEND_PORT" "$BACKEND_PORT"; do
    listeners="$(ss -ltnp "sport = :$port" 2>/dev/null || true)"
    [ "$(printf '%s\n' "$listeners" | wc -l)" -le 1 ] && { pass "port $port libre"; continue; }
    holder="$(printf '%s\n' "$listeners" | sed -n '2p')"
    # Occupe par NOTRE conteneur = normal en cours de deploiement.
    if printf '%s' "$holder" | grep -qE "docker-proxy|(backend|frontend|db)-1|${PROJECT_NAME}"; then
      pass "port $port deja tenu par uSwap (relance idempotente)"
    else
      fail_domain network "port $port deja utilise par un autre service : $holder"
      info "changer FRONTEND_HOST_PORT / BACKEND_HOST_PORT dans deploy/.env (ne pas arreter l'autre application)"
    fi
  done
}

check_compose_config() {
  if compose config >/dev/null 2>&1; then
    pass "configuration Compose valide"
  else
    fail_domain config "configuration Compose invalide"
    info "detail : docker compose -f $COMPOSE_FILE --env-file $ENV_FILE config"
    compose config 2>&1 | sed 's/^/        /' | head -n 20 || true
  fi
}

# Etat des services (`running` accepte : la sonde peut manquer).
check_services() {
  local service status
  for service in db backend frontend; do
    status="$(health_of "$service")"
    case "$MODE" in
      check|diagnose)
        case "$status" in
          healthy) pass "$service healthy" ;;
          running) soft "$service running (pas de sonde)" ;;
          absent)  soft "$service non demarre (mode lecture seule)" ;;
          *)       fail_domain network "$service : $status" ;;
        esac
        ;;
      *)
        case "$status" in
          healthy|running) pass "$service $status" ;;
          *) soft "$service $status (sera (re)demarre par le deploiement)" ;;
        esac
        ;;
    esac
  done
}

check_apache_config() {
  if [ ! -f "$APACHE_CONF" ]; then
    soft "deploy/apache/uswap.conf absent : Apache non pris en charge"
    return
  fi
  if ! have apache2ctl; then
    soft "Apache non installe sur ce serveur : le VirtualHost uSwap est ignore"
    return
  fi
  pass "Apache present ($(apache2ctl -v 2>/dev/null | head -n1 || echo inconnu))"

  if [ ! -f "$APACHE_TARGET" ]; then
    soft "VirtualHost uSwap pas encore installe : --deploy/--repair l'installera"
  elif grep -qF "127.0.0.1:${FRONTEND_PORT}" "$APACHE_TARGET" 2>/dev/null; then
    pass "VirtualHost $APACHE_TARGET pointe vers 127.0.0.1:${FRONTEND_PORT}"
  else
    fail_domain network "VirtualHost $APACHE_TARGET ne pointe pas vers 127.0.0.1:${FRONTEND_PORT} (frontend deplace ?)"
  fi

  local site
  site="$(basename "$APACHE_TARGET" .conf)"
  if [ -L "/etc/apache2/sites-enabled/$site.conf" ]; then
    pass "site Apache $site active"
  else
    soft "site Apache $site non active (a2ensite $site)"
  fi

  if apache2ctl configtest >/dev/null 2>&1; then
    pass "apache2ctl configtest : Syntax OK"
  else
    fail_domain network "apache2ctl configtest en echec : Apache ne sera PAS recharge"
    apache2ctl configtest 2>&1 | sed 's/^/        /' | head -n 10 || true
  fi
}

# Ordre volontaire : la configuration est evaluee AVANT le repli, pour que
# « .env absent » soit toujours dominant (code 4) meme quand Docker manque.
run_checks() {
  step "1/10  Prerequis du serveur"
  check_root
  check_tools

  sub "Sources du depot"
  check_sources

  step "2/10  Fichier de production (deploy/.env)"
  FRONTEND_PORT=8080
  BACKEND_PORT=3000
  PUBLIC_DOMAIN=""
  GOOGLE_ID=""
  GOOGLE_DOMAINS="upowa.org"
  BIND_ADDRESS="127.0.0.1"
  if check_env_file; then
    sub "Valeurs obligatoires et coherentes"
    check_env_values
  fi

  sub "Docker"
  check_docker

  if [ "$count_fail" -gt 0 ]; then
    step "Arret des controles dependant de la configuration"
    bad "les controles suivants sont ignores tant que les points ci-dessus ne sont pas corriges"
    return
  fi

  step "3/10  Configuration Compose, ports, services"
  check_compose_config

  sub "Ports sur l'hote"
  check_ports

  sub "Services uSwap"
  check_services

  sub "Apache"
  check_apache_config
}
# =============================================================================
#  SECTION F — DIAGNOSTIC (--diagnose)
# =============================================================================

diagnose_containers() {
  sub "Conteneurs, images et redemarrages"
  local service images
  images="$(compose images 2>/dev/null || true)"
  if [ -n "$images" ]; then
    printf '%s\n' "$images" | sed 's/^/        /'
  else
    info "aucune image construite pour le projet $PROJECT_NAME"
  fi

  local id restarts image created
  for service in db backend frontend; do
    id="$(compose ps -q "$service" 2>/dev/null | head -n 1 || true)"
    if [ -z "$id" ]; then
      info "$service : aucun conteneur"
      continue
    fi
    restarts="$(docker inspect -f '{{.RestartCount}}' "$id" 2>/dev/null || echo '?')"
    image="$(docker inspect -f '{{.Image}}' "$id" 2>/dev/null | cut -c8-19 || echo '?')"
    created="$(docker inspect -f '{{.Config.Image}}' "$id" 2>/dev/null || echo '?')"
    info "$service : $(health_of "$service")  redemarrages=$restarts  image=$created@$image"
    if [ "${restarts:-0}" -gt 3 ] 2>/dev/null && [ "$MODE" = "diagnose" ]; then
      soft "$service a redemarre $restarts fois : instabilite (voir les journaux ci-dessous)"
    fi
  done
}

diagnose_backend_logs() {
  sub "Journaux backend : causes de 502 connues"
  local logs
  logs="$(compose logs --tail=400 backend 2>/dev/null || true)"
  if [ -z "$logs" ]; then
    info "aucune sortie : le conteneur backend n'a jamais demarre"
    return
  fi

  local found=0
  if printf '%s' "$logs" | grep -qE "P1001|Can't reach database server"; then
    warn "base injoignable (Prisma P1001) : db arretee ou DATABASE_URL fausse"
    found=1
  fi
  if printf '%s' "$logs" | grep -qE "P2021|P3005|does not exist in the current database"; then
    warn "schema absent (Prisma P2021/P3005) : les migrations n'ont pas ete appliquees"
    found=1
  fi
  if printf '%s' "$logs" | grep -qE "P1000|password authentication failed|role \".*\" does not exist|database \".*\" does not exist"; then
    warn "identifiants ou base PostgreSQL refuses : POSTGRES_PASSWORD/USER/DB de deploy/.env ne correspondent pas au volume"
    found=1
  fi
  if printf '%s' "$logs" | grep -qE "EADDRINUSE|address already in use"; then
    warn "port 3000 deja utilise dans le conteneur (deux backends ?)"
    found=1
  fi
  if printf '%s' "$logs" | grep -qE "Error: Cannot find module|MODULE_NOT_FOUND"; then
    warn "module absent dans l'image : contexte de build incomplet, reconstruire backend"
    found=1
  fi
  if printf '%s' "$logs" | grep -qE "JWT_SECRET|JWT_REFRESH_SECRET"; then
    warn "secret JWT signale dans les journaux : deploy/.env lu partiellement"
    found=1
  fi
  if printf '%s' "$logs" | grep -qE "Nest application successfully started|API uSwap disponible"; then
    pass "le backend a demarre au moins une fois"
  else
    warn "le message de demarrage Nest n'apparait pas : le backend n'a jamais fini de demarrer"
    found=1
  fi
  if printf '%s' "$logs" | grep -q "Acces administrateur restaure"; then
    soft "le backend a restaure automatiquement un acces ADMIN (compte etait desactive)"
  fi
  if [ "$found" -eq 0 ]; then
    pass "aucune cause connue de 502 dans les journaux backend"
  fi
}

diagnose_migrations() {
  sub "Migrations Prisma"
  local output status
  set +e
  output="$(compose_tools migrate status 2>&1)"
  status=$?
  set -e
  printf '%s\n' "$output" | sed 's/^/        /' | tail -n 25
  if [ "$status" -ne 0 ]; then
    fail_domain network "migrate status a echoue (code $status) : base inaccessible ou service tools en erreur"
    return
  fi
  if printf '%s' "$output" | grep -qiE "up to date|Database schema is up to date|No pending migrations"; then
    pass "schema a jour"
  elif printf '%s' "$output" | grep -qiE "not yet been applied|pending|following migrations have not"; then
    soft "migrations en attente : --repair les appliquera (migrate deploy, additif)"
  elif printf '%s' "$output" | grep -qiE "drift|failed to apply|divergent"; then
    fail_domain network "derive de schema detectee : intervention manuelle requise (ne JAMAIS reset en production)"
  else
    soft "etat des migrations non concluant : lire la sortie ci-dessus"
  fi
}

diagnose_database() {
  sub "PostgreSQL"
  local user db ping
  user="$(read_env_value POSTGRES_USER uswap)"
  db="$(read_env_value POSTGRES_DB uswap)"
  if [ "$(health_of db)" = "absent" ] && [ "$MODE" = "diagnose" ]; then
    soft "db non demarree : mesures limitees"
    return
  fi
  ping="$(compose exec -T db pg_isready -U "$user" -d "$db" 2>&1 || true)"
  if printf '%s' "$ping" | grep -q "accepting connections"; then
    pass "PostgreSQL accepte les connexions ($db)"
  else
    fail_domain network "PostgreSQL refuse les connexions : ${ping:-pas de reponse}"
    return
  fi

  local counts
  counts="$(compose exec -T db psql -U "$user" -d "$db" -tAc \
    "select (select count(*) from public._prisma_migrations),
            (select count(*) from public._prisma_migrations where finished_at is null),
            (select count(*) from information_schema.tables where table_schema='public');" \
    2>/dev/null || true)"
  if [ -n "$counts" ]; then
    info "migrations enregistrees / en echec / tables : $(printf '%s' "$counts" | tr -d ' ' | tr '|' / )"
  fi

  local users_result
  users_result="$(compose exec -T db psql -U "$user" -d "$db" -tAc \
    "select role, count(*) from public.users
     where \"disabledAt\" is null and \"isActive\" = true group by role order by role;
     select count(*) from public.users where role in ('SUPER_ADMIN','ADMIN');" \
    2>/dev/null || true)"
  if [ -n "$users_result" ]; then
    printf '%s\n' "$users_result" | sed '/^$/d;s/^/        comptes actifs : /'
  else
    soft "table users illisible (schema non migre ?)"
  fi
}

# Resolution DNS + socket direct : distingue « backend mort » de « proxy
# mal configure ». C'est la question exacte du 502.
diagnose_backend_reachability() {
  sub "Joignabilite du backend (hors proxy)"

  if [ "$(health_of backend)" = "absent" ]; then
    soft "backend non demarre : test direct impossible"
  else
    local socket_code
    socket_code="$(compose exec -T backend node -e \
      "fetch('http://127.0.0.1:3000/auth/session').then(r=>{console.log(r.status);process.exit(0)}).catch(()=>{console.log('ERR');process.exit(0)})" \
      2>/dev/null | tr -d '\r' | tail -n 1 || true)"
    case "$socket_code" in
      204|401) pass "le backend ecoute et repond en local (HTTP $socket_code sur /auth/session)" ;;
      ERR|"") fail_domain network "le backend n'ecoute pas sur 127.0.0.1:3000 (processus mort ou PORT different)" ;;
      502)    fail_domain network "le backend renvoie lui-meme 502 (regression applicative)" ;;
      *)      soft "reponse inattendue du backend en local : HTTP $socket_code" ;;
    esac

    local dns
    dns="$(compose exec -T frontend getent hosts backend 2>/dev/null | head -n 1 || true)"
    if [ -n "$dns" ]; then
      pass "le conteneur frontend resout 'backend' ($dns)"
    else
      fail_domain network "le nom 'backend' n'est pas resolu depuis le conteneur frontend : proxy_pass voue au 502"
      info "verifier que frontend et backend partagent le reseau uswap-internal : docker compose ps"
    fi
  fi

  local host_code
  host_code="$(http_code "http://127.0.0.1:${BACKEND_PORT}/auth/session")"
  case "$host_code" in
    204|401) pass "socket publie 127.0.0.1:${BACKEND_PORT} repond (HTTP $host_code)" ;;
    000)     soft "127.0.0.1:${BACKEND_PORT} injoignable : conteneur arrete ou BACKEND_HOST_PORT different" ;;
    *)       soft "127.0.0.1:${BACKEND_PORT} repond HTTP $host_code (attendu 204)" ;;
  esac
}

# Les deux routeurs HTTP qui peuvent produire un 502 : le Nginx du conteneur
# et Apache. Le code 502 est mesure sur chacune des deux couches.
diagnose_routers() {
  sub "Routeurs HTTP (Nginx du conteneur, puis Apache)"

  local nginx_session
  nginx_session="$(http_code "http://127.0.0.1:${FRONTEND_PORT}/api/auth/session")"
  case "$nginx_session" in
    204|401) pass "Nginx conteneur : /api/auth/session -> HTTP $nginx_session (proxy OK)" ;;
    502)     fail_domain network "Nginx conteneur renvoie 502 sur /api/auth/session : backend injoignable depuis Nginx" ;;
    504)     fail_domain network "Nginx conteneur renvoie 504 : backend trop lent" ;;
    000)     fail_domain network "Nginx conteneur injoignable sur 127.0.0.1:${FRONTEND_PORT}" ;;
    *)       soft "Nginx conteneur : /api/auth/session -> HTTP $nginx_session" ;;
  esac

  # Anti-regression : un bundle construit sans VITE_API_URL appelle la
  # maquette locale. On ne peut le voir que dans le JS livre.
  local bundle refs mock_refs
  bundle="$(http_body "http://127.0.0.1:${FRONTEND_PORT}/")"
  if printf '%s' "$bundle" | grep -q '<div id="root">'; then
    pass "Nginx conteneur sert bien le bundle SPA"
  else
    fail_domain network "Nginx conteneur ne sert pas index.html (code HTTP $(http_code "http://127.0.0.1:${FRONTEND_PORT}/"))"
  fi

  if [ "$MODE" = "diagnose" ]; then
    refs="$(compose exec -T frontend sh -c 'grep -l "/api" /usr/share/nginx/html/assets/*.js 2>/dev/null | wc -l' 2>/dev/null | tr -d '\r ' || echo 0)"
    mock_refs="$(compose exec -T frontend sh -c 'grep -l "maquette\|mockRequest\|MOCK_" /usr/share/nginx/html/assets/*.js 2>/dev/null | wc -l' 2>/dev/null | tr -d '\r ' || echo 0)"
    if [ "${refs:-0}" -gt 0 ]; then
      pass "le bundle livre contient des appels /api (${refs} fichier(s))"
    else
      soft "aucun appel /api trouve dans le bundle : image construite sans VITE_API_URL ?"
    fi
    if [ "${mock_refs:-0}" -gt 0 ]; then
      soft "du code de maquette est present dans le bundle (${mock_refs} fichier(s)) : verifier que l'ecran n'est pas en mode demo"
    fi
  fi

  local spa_code
  spa_code="$(http_code "http://127.0.0.1:${FRONTEND_PORT}/app/admin")"
  if [ "$spa_code" = "200" ]; then
    pass "route SPA /app/admin -> 200 (routage SPA)"
  else
    fail_domain network "route SPA /app/admin -> HTTP $spa_code (try_files / index.html en cause)"
  fi

  # --- Apache, uniquement s'il est installe -------------------------------
  if ! have apache2ctl; then
    soft "Apache absent : verification limitee au conteneur"
    return
  fi

  local site
  site="$(basename "$APACHE_TARGET" .conf)"
  if [ ! -L "/etc/apache2/sites-enabled/$site.conf" ]; then
    soft "site Apache $site non active : HTTP public non teste"
    return
  fi

  local apache_home apache_api apache_health
  apache_home="$(http_code -H "Host: ${PUBLIC_DOMAIN}" "http://127.0.0.1/")"
  apache_api="$(http_code -H "Host: ${PUBLIC_DOMAIN}" "http://127.0.0.1/api/auth/session")"
  apache_health="$(http_code -H "Host: ${PUBLIC_DOMAIN}" "http://127.0.0.1/api/health")"
  info "Apache HTTP  (Host ${PUBLIC_DOMAIN}) : / -> $apache_home   /api/auth/session -> $apache_api"
  case "$apache_api" in
    204|401) pass "Apache relaie /api/auth/session (HTTP $apache_api)" ;;
    502)     fail_domain network "Apache renvoie 502 : ProxyPass ou conteneur frontend en cause, pas le backend" ;;
    000)     soft "Apache ne repond pas en HTTP local (port 80 filtre ?)" ;;
    *)       soft "Apache : /api/auth/session -> HTTP $apache_api" ;;
  esac

  if [ "$apache_health" = "502" ] && [ "$apache_api" != "502" ]; then
    soft "Apache renvoie 502 sur /api/health (route inexistante en amont) : artifact possible de la sonde"
  fi

  # En-tetes de securite : un agent de securite ou une seconde couche peut
  # bloquer le POST de connexion. Lisible seulement si curl a TLS.
  local https_headers
  https_headers="$(curl -sS -o /dev/null -D - --max-time 8 -k "https://127.0.0.1/api/auth/session" \
                   -H "Host: ${PUBLIC_DOMAIN}" 2>/dev/null | head -n 20 || true)"
  if [ -n "$https_headers" ]; then
    if printf '%s' "$https_headers" | grep -qiE "x-frame-options|content-security-policy|strict-transport-security"; then
      info "en-tetes HTTPS presents : $(printf '%s' "$https_headers" | grep -iE 'x-frame-options|content-security-policy' | tr -d '\r' | tr '\n' ' ')"
    fi
  fi
}

# Compte super administrateur : existant, actif, non desactive. Mesure en base
# par le compte technique (aucun mot de passe teste ici).
diagnose_superadmin_account() {
  sub "Compte super administrateur"
  local email user db row
  email="$(read_env_value SUPERADMIN_EMAIL)"; email="$(printf '%s' "$email" | tr 'A-Z' 'a-z')"
  user="$(read_env_value POSTGRES_USER uswap)"
  db="$(read_env_value POSTGRES_DB uswap)"
  row="$(compose exec -T db psql -U "$user" -d "$db" -tAc \
    "select role || '|' || \"isActive\" || '|' || coalesce(\"disabledAt\"::text,'-') || '|' || \"invitationStatus\" || '|' || coalesce(\"lockedUntil\"::text,'-') from public.users where email = '${email}';" \
    2>/dev/null | tr -d '\r' | head -n 1 || true)"

  if [ -z "$row" ]; then
    fail_domain login "aucun compte ${email} en base : le bootstrap n'a pas ete joue (ou l'adresse a change)"
    return
  fi
  local role active disabled invitation locked
  role="$(printf '%s' "$row" | cut -d'|' -f1)"
  active="$(printf '%s' "$row" | cut -d'|' -f2)"
  disabled="$(printf '%s' "$row" | cut -d'|' -f3)"
  invitation="$(printf '%s' "$row" | cut -d'|' -f4)"
  locked="$(printf '%s' "$row" | cut -d'|' -f5)"
  if [ "$role" != "SUPER_ADMIN" ]; then
    fail_domain login "le compte ${email} existe avec le role $role (attendu SUPER_ADMIN) : connexion /auth/login/superadmin impossible"
  elif [ "$active" != "t" ]; then
    fail_domain login "le compte ${email} n'est pas actif : la connexion par mot de passe repondra 403"
  elif [ "$disabled" != "-" ]; then
    fail_domain login "le compte ${email} est desactive (disabledAt=$disabled) : connexion 403"
  elif [ "$locked" != "-" ]; then
    soft "le compte ${email} est verrouille jusqu'a $locked (trop d'essais) : la connexion repondra 429"
  else
    pass "compte ${email} SUPER_ADMIN, actif, non verrouille (invitation=$invitation)"
  fi
}
# =============================================================================
#  SECTION G — PARCOURS DE CONNEXION
# =============================================================================
#
#  G.1 E-mail + mot de passe : reproduit le 502 signale, en le classant.
#  G.2 Google : non-regression UNIQUEMENT (aucun appel a Google, aucune
#      configuration modifiee).
#
# =============================================================================

# --- G.1 : POST /auth/login/<role> ------------------------------------------

# Tente la connexion et classe le resultat :
#   OK       200 + accessToken
#   429      compte verrouille (ne pas insister : aucun autre essai)
#   502      proxy : le backend n'a pas repondu (cas historique)
#   401/403/404/400/5xx  reponse applicative (a interpreter)
login_attempt() {
  local base_url="$1"
  local role="${2:-superadmin}"
  local email password jar body payload

  email="$(read_env_value SUPERADMIN_EMAIL)"
  password="$(read_env_value SUPERADMIN_PASSWORD)"
  jar="$(mktemp)"
  body="$(mktemp)"

  # Le corps JSON est ecrit dans un fichier : un mot de passe contenant des
  # guillemets ou des barres obliques inverses casserait une concatenation
  # shell. `--data-binary @fichier` transmet exactement ce qui est ecrit.
  payload="$(mktemp)"
  printf '{"email":"%s","password":"%s"}' "$email" "$password" > "$payload"

  # `|| true` est DANS la substitution : sans lui, un curl en echec reseau
  # declencherait le trap ERR et arreteraient le script (verifie en test).
  LOGIN_CODE="$(curl -sS -o "$body" -w '%{http_code}' --max-time 20 \
    -c "$jar" -b "$jar" \
    -H 'Content-Type: application/json' \
    -H 'X-USwap-Client: deploy-check' \
    --data-binary "@${payload}" \
    "${base_url}/api/auth/login/${role}" 2>/dev/null || true)"
  LOGIN_CODE="$(norm_code "${LOGIN_CODE:-}")"

  LOGIN_BODY="$(cat "$body" 2>/dev/null || true)"
  LOGIN_JAR="$jar"
  LOGIN_ACCESS="$(json_string "$LOGIN_BODY" accessToken)"

  # Le mot de passe ne doit JAMAIS subsister sur le disque.
  rm -f "$payload"
  rm -f "$body"
}

# Ferme une session de test et supprime son fichier de cookies.
release_login_jar() {
  if [ -n "${LOGIN_JAR:-}" ] && [ -f "${LOGIN_JAR:-}" ]; then
    rm -f "$LOGIN_JAR"
  fi
  LOGIN_JAR=""
  LOGIN_ACCESS=""
}

# Une erreur 502 doit toujours etre expliquee, jamais seulement constatee.
# `fail_domain login` compte l'anomalie ET alimente le code de sortie : sans
# cela le rapport affichait un 502 en rouge avec « 0 anomalie ».
explain_502() {
  local label="$1"
  fail_domain login "$label : HTTP 502 — un proxy n'a pas obtenu de reponse du backend"
  info "cause probable (la premiere ligne vraie est dans le diagnostic ci-dessus) :"
  info "  - conteneur backend arrete, en redemarrage ou plante au demarrage ;"
  info "  - migrations non appliquees (Prisma P2021) ou base injoignable (P1001) ;"
  info "  - nom 'backend' non resolu depuis Nginx (reseau uswap-internal absent)."
  info "suite : sudo bash deploy/deploy.sh --repair, puis relancer ce diagnostic."
}

# Le cookie HttpOnly est la preuve que la session survit au rechargement :
# s'il manque, la connexion « reussit » puis echoue au premier /auth/refresh.
#
# Le fichier de cookies de curl est au format Netscape : les attributs
# HttpOnly / Secure sont prefixes au NOM du cookie (`#HttpOnly_127.0.0.1`),
# pas dans une colonne separee. C'est ce marqueur qu'on cherche.
check_session_cookie() {
  local jar="$1"
  local line
  line="$(grep -a "uswap_refresh" "$jar" 2>/dev/null | tail -n 1)"
  if [ -z "$line" ]; then
    soft "aucun cookie uswap_refresh recu : la session ne survivra pas a un rechargement"
    info "verifier COOKIE_SECURE (true exige HTTPS) et que le navigateur vise la MEME origine que l'API"
    return 1
  fi

  local http_only=0 secure=0
  case "$line" in
    \#HttpOnly_*) http_only=1 ;;
  esac
  # Format Netscape : domaine TAB flag TAB chemin TAB SECURE TAB ...
  if printf '%s' "$line" | awk -F'\t' '$4 == "TRUE" {found=1} END {exit found ? 0 : 1}'; then
    secure=1
  fi

  if [ "$http_only" -eq 1 ] && [ "$secure" -eq 1 ]; then
    pass "cookie uswap_refresh : HttpOnly + Secure"
  elif [ "$http_only" -eq 1 ]; then
    pass "cookie uswap_refresh : HttpOnly (non Secure, attendu si COOKIE_SECURE=false)"
  else
    soft "cookie uswap_refresh sans HttpOnly : un script de la page pourrait le lire"
  fi
  return 0
}

# =============================================================================
#  LE TEST DECISIF : « le navigateur accepterait-il cette session ? »
# =============================================================================
#
# POURQUOI CE TEST EXISTE
#
#   curl accepte un cookie `Secure` recu en HTTP ; un navigateur le REJETTE
#   silencieusement. Consequence vecue lors du dernier deploiement :
#
#     POST /api/auth/login   -> 200, accessToken renvoye    (curl : OK)
#     cookie uswap_refresh   -> redige avec `Secure`
#     navigateur             -> ignore le cookie
#     GET  /api/auth/refresh -> 401 (aucun cookie)
#     -> retour a l'ecran de connexion, « ca ne fonctionne pas »
#
#   Google emprunte le MEME `startSession()` : les deux parcours tombent
#   ensemble. C'est exactement le symptome signale.
#
# Le cycle ci-dessous applique les regles du navigateur : un cookie `Secure`
# n'est ni stocke ni renvoye sur un canal HTTP.
# =============================================================================

# Le canal public est-il HTTPS ? Mesure sur PUBLIC_APP_URL.
public_scheme() {
  case "$(norm_url "$(read_env_value PUBLIC_APP_URL)")" in
    https://*) printf 'https' ;;
    *)         printf 'http' ;;
  esac
}

# Simulation de navigateur : POST login, puis POST refresh en appliquant la
# regle du navigateur sur les cookies `Secure`.
#
# Positionne BROWSER_VERDICT a :
#   OK / NO_COOKIE / COOKIE_REJECTED / REFRESH_FAILED / LOGIN_FAILED
browser_login_cycle() {
  local base_url="$1"
  local scheme="$2"
  local headers body payload set_cookie secure_cookie refresh_code

  headers="$(mktemp)"; body="$(mktemp)"; payload="$(mktemp)"

  printf '{"email":"%s","password":"%s"}' \
    "$(read_env_value SUPERADMIN_EMAIL)" "$(read_env_value SUPERADMIN_PASSWORD)" > "$payload"

  BROWSER_LOGIN_CODE="$(curl -sS -o "$body" -D "$headers" -w '%{http_code}' --max-time 20 \
    -H 'Content-Type: application/json' \
    -H 'X-USwap-Client: deploy-check' \
    --data-binary "@${payload}" \
    "${base_url}/api/auth/login/superadmin" 2>/dev/null || true)"
  BROWSER_LOGIN_CODE="$(norm_code "${BROWSER_LOGIN_CODE:-}")"
  rm -f "$payload"

  if [ "$BROWSER_LOGIN_CODE" != "200" ]; then
    BROWSER_VERDICT="LOGIN_FAILED"
    rm -f "$headers" "$body"
    return 0
  fi
  rm -f "$body"

  set_cookie="$(grep -i '^set-cookie:.*uswap_refresh' "$headers" 2>/dev/null | head -n1 | tr -d '\r')"
  rm -f "$headers"

  if [ -z "$set_cookie" ]; then
    BROWSER_VERDICT="NO_COOKIE"
    return 0
  fi

  secure_cookie=0
  printf '%s' "$set_cookie" | grep -qi ';[[:space:]]*secure' && secure_cookie=1

  # REGLE DU NAVIGATEUR : un cookie `Secure` n'est jamais stocke ni renvoye
  # sur un canal HTTP. C'est le coeur du diagnostic.
  if [ "$secure_cookie" -eq 1 ] && [ "$scheme" = "http" ]; then
    BROWSER_VERDICT="COOKIE_REJECTED"
    return 0
  fi

  # Cookie accepte par le navigateur : il est renvoye a /auth/refresh.
  refresh_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 \
    -H "Cookie: $(printf '%s' "$set_cookie" | sed 's/^[Ss]et-[Cc]ookie:[[:space:]]*//' | cut -d';' -f1)" \
    -X POST "${base_url}/api/auth/refresh" 2>/dev/null || true)"
  refresh_code="$(norm_code "${refresh_code:-}")"

  if [ "$refresh_code" = "200" ]; then
    BROWSER_VERDICT="OK"
  else
    BROWSER_VERDICT="REFRESH_FAILED"
    BROWSER_REFRESH_CODE="$refresh_code"
  fi
  return 0
}

# Verdict metier : la session survit-elle comme dans un VRAI navigateur ?
verify_browser_session() {
  local scheme base_url
  scheme="$(public_scheme)"
  base_url="http://127.0.0.1:${FRONTEND_PORT}"

  sub "Simulation navigateur : login puis renouvellement (canal ${scheme})"
  browser_login_cycle "$base_url" "$scheme"

  case "$BROWSER_VERDICT" in
    OK)
      pass "cycle complet confirme : login 200, cookie accepte, refresh 200 (comme un navigateur)"
      ;;
    COOKIE_REJECTED)
      fail_domain login "cookie uswap_refresh marque 'Secure' mais le site est servi en HTTP : le NAVIGATEUR l'ignore -> connexion impossible, par mot de passe COMME par Google"
      info "c'est la cause exacte d'un login qui « reussit » puis renvoie a l'ecran de connexion."
      info "correction (au choix) :"
      info "  a) servir le site en HTTPS (Apache + certbot) et garder COOKIE_SECURE=true ;"
      info "  b) pour une recette en HTTP : COOKIE_SECURE=false dans deploy/.env, puis --deploy"
      ;;
    NO_COOKIE)
      fail_domain login "login 200 mais AUCUN cookie de session : le navigateur n'aura pas de session"
      info "verifier COOKIE_SECURE/COOKIE_SAMESITE et que le proxy ne supprime pas Set-Cookie"
      ;;
    REFRESH_FAILED)
      fail_domain login "cookie accepte mais /auth/refresh repond ${BROWSER_REFRESH_CODE:-?} : la session ne survit pas au rechargement"
      info "cause frequente : JWT_REFRESH_SECRET modifie sans redemarrage, ou session revoquee"
      ;;
    LOGIN_FAILED)
      fail_domain login "login refuse (HTTP ${BROWSER_LOGIN_CODE}) : voir le detail du parcours A"
      ;;
  esac
}

# Rafraichissement puis deconnexion : prouve que le cookie est relu, et ferme
# la session de test (aucun jeton ne reste actif apres le deploiement).
check_refresh_and_logout() {
  local base_url="$1"
  local jar="$2"
  local refresh_code logout_code
  refresh_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -b "$jar" -c "$jar" \
    -X POST "${base_url}/api/auth/refresh" 2>/dev/null || true)"
  refresh_code="$(norm_code "$refresh_code")"
  case "$refresh_code" in
    200) pass "renouvellement de session : HTTP 200 (cookie relu)" ;;
    401) fail_domain login "renouvellement : HTTP 401 alors qu'une session vient d'etre ouverte (cookie rejete)" ;;
    *)   soft "renouvellement : HTTP $refresh_code" ;;
  esac
  logout_code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -b "$jar" -c "$jar" \
    -X POST "${base_url}/api/auth/logout" 2>/dev/null || true)"
  logout_code="$(norm_code "$logout_code")"
  case "$logout_code" in
    200) pass "deconnexion du compte de test : HTTP 200 (session de test fermee)" ;;
    *)   soft "deconnexion du compte de test : HTTP $logout_code (revoquer manuellement si besoin)" ;;
  esac
}

verify_password_login() {
  step "Parcours A — connexion e-mail et mot de passe"

  local password email
  password="$(read_env_value SUPERADMIN_PASSWORD)"
  email="$(read_env_value SUPERADMIN_EMAIL)"

  # Garde-fou : ne jamais verrouiller un compte reel avec un mot de passe qui
  # n'est manifestement pas celui du compte (modele, demonstration).
  if is_placeholder "$password" || printf '%s' "$password" | grep -q "Demo"; then
    soft "verification NON executee : SUPERADMIN_PASSWORD ressemble a un modele"
    info "le script ne tente pas de connexion avec une valeur qui verrouillerait le compte"
    info "corriger le mot de passe dans deploy/.env, puis relancer --deploy"
  else
    sub "Test 1 — via le proxy Nginx du conteneur (127.0.0.1:${FRONTEND_PORT})"
    login_attempt "http://127.0.0.1:${FRONTEND_PORT}" superadmin
    case "$LOGIN_CODE" in
      200)
        if [ -n "$LOGIN_ACCESS" ]; then
          pass "HTTP 200 + accessToken recu pour ${email} (/auth/login/superadmin)"
          check_session_cookie "$LOGIN_JAR"
          check_refresh_and_logout "http://127.0.0.1:${FRONTEND_PORT}" "$LOGIN_JAR"
        else
          fail_domain login "HTTP 200 mais aucun accessToken : contrat de session inattendu"
        fi
        ;;
      502) explain_502 "Nginx conteneur" ;;
      429) soft "HTTP 429 : compte verrouille par de precedentes tentatives (aucun autre essai)"
           info "le verrou expirera seul ; ne pas relancer la connexion en boucle" ;;
      401) fail_domain login "HTTP 401 : mot de passe de SUPERADMIN_PASSWORD different de celui du compte" ;;
      403) fail_domain login "HTTP 403 : compte desactive, non active, ou role different de SUPERADMIN (test /auth/login/superadmin)" ;;
      404) fail_domain login "HTTP 404 : route /auth/login/superadmin absente (image backend anterieure au code actuel ?)" ;;
      400) fail_domain login "HTTP 400 : requete refusee par la validation (e-mail invalide dans deploy/.env ?)" ;;
      500|503|504) fail_domain login "HTTP $LOGIN_CODE : erreur du backend (voir les journaux ci-dessus)" ;;
      000) fail_domain login "aucune reponse du proxy Nginx sur 127.0.0.1:${FRONTEND_PORT}" ;;
      *)   fail_domain login "code inattendu : HTTP $LOGIN_CODE" ;;
    esac

    # Test 2 — le meme POST, mais a travers Apache : c'est ce que le
    # navigateur fait reellement. Un 502 ici seulement designe Apache.
    if have apache2ctl && [ -L "/etc/apache2/sites-enabled/$(basename "$APACHE_TARGET" .conf).conf" ]; then
      sub "Test 2 — via Apache (Host: ${PUBLIC_DOMAIN})"
      login_attempt "http://127.0.0.1" superadmin
      case "$LOGIN_CODE" in
        200) pass "HTTP 200 via Apache : la chaine complete (Apache -> Nginx -> API) fonctionne"
             # Session de test ouverte inutilement : on la ferme proprement.
             curl -sS -o /dev/null --max-time 8 -b "$LOGIN_JAR" -c "$LOGIN_JAR" \
               -X POST "http://127.0.0.1/api/auth/logout" >/dev/null 2>&1 || true
             release_login_jar ;;
        502) explain_502 "Apache" ;;
        000) soft "Apache injoignable depuis le serveur (port 80 non servi en local) : non bloquant" ;;
        401|403|429) soft "HTTP $LOGIN_CODE via Apache : meme refus applicatif qu'a travers Nginx (attendu)" ;;
        *) soft "via Apache : HTTP $LOGIN_CODE" ;;
      esac
    else
      soft "Apache non installe ou site uSwap inactif : test via Apache ignore"
    fi
  fi

  release_login_jar
}

# --- G.2 : Google, non-regression -------------------------------------------

# Le bundle doit contenir le MEME identifiant que le backend : sinon le bouton
# Google n'est plus rendu (VITE_GOOGLE_CLIENT_ID vide au build) alors que
# /auth/google reste actif cote serveur.
verify_google_bundle() {
  local client_id="$1"
  local found
  if [ "$(health_of frontend)" = "absent" ]; then
    soft "conteneur frontend indisponible : bundle non inspecte"
    return
  fi
  found="$(compose exec -T frontend sh -c \
    "grep -l '${client_id}' /usr/share/nginx/html/assets/*.js 2>/dev/null | wc -l" 2>/dev/null | tr -d '\r ' || echo 0)"
  if [ "${found:-0}" -gt 0 ]; then
    pass "bundle frontend construit avec VITE_GOOGLE_CLIENT_ID (bouton Google present)"
  else
    fail_domain google "GOOGLE_CLIENT_ID present dans deploy/.env mais ABSENT du bundle : image frontend construite avant l'ajout de l'identifiant"
    info "correction sure : sudo bash deploy/deploy.sh --deploy (reconstruit le frontend)"
  fi
}

verify_google_login() {
  step "Parcours B — connexion Google (non-regression, sans reconfiguration)"

  local client_id allowed email domain
  client_id="$(read_env_value GOOGLE_CLIENT_ID)"
  allowed="$(read_env_value GOOGLE_ALLOWED_DOMAINS upowa.org)"
  email="$(read_env_value SUPERADMIN_EMAIL)"
  domain="$(printf '%s' "$email" | sed 's/.*@//')"

  if [ -z "$client_id" ]; then
    soft "GOOGLE_CLIENT_ID vide : parcours Google desactive par configuration (non-regression non mesurable)"
    return
  fi
  pass "GOOGLE_CLIENT_ID configure (format client OAuth Web)"

  case ",${allowed}," in
    *",${domain},"*) pass "domaine du compte super admin (${domain}) autorise par GOOGLE_ALLOWED_DOMAINS" ;;
    *) fail_domain google "GOOGLE_ALLOWED_DOMAINS=${allowed} ne couvre pas ${domain} : connexion Google du super admin refusee en 403" ;;
  esac

  # Aucun jeton reel n'est utilise : un identifiant bidon ne peut que produire
  # un refus METIER (401 GAuth), ce qui prouve que le parcours est arme.
  local body http_code_v
  body="$(mktemp)"
  http_code_v="$(curl -sS -o "$body" -w '%{http_code}' --max-time 20 \
    -H 'Content-Type: application/json' \
    --data '{"idToken":"uswap-deploy-probe-not-a-google-token-0000000000"}' \
    "http://127.0.0.1:${FRONTEND_PORT}/api/auth/google" 2>/dev/null || true)"
  http_code_v="$(norm_code "$http_code_v")"
  local response
  response="$(cat "$body" 2>/dev/null || true)"
  rm -f "$body"

  case "$http_code_v" in
    401) pass "POST /api/auth/google -> 401 (refus metier d'un jeton invalide : parcours actif)" ;;
    400)
      if printf '%s' "$response" | grep -qi "pas configur"; then
        fail_domain google "POST /api/auth/google -> 400 « non configure » : GOOGLE_CLIENT_ID absent du conteneur backend"
        info "cause : variable retiree ou deploy/.env modifie depuis le dernier demarrage"
      else
        soft "POST /api/auth/google -> 400 (jeton invalide refuse avant verification)"
      fi
      ;;
    502) explain_502 "POST /api/auth/google" ;;
    500) fail_domain google "POST /api/auth/google -> 500 : le service Google tombe (voir journaux backend)" ;;
    000) fail_domain google "POST /api/auth/google : aucune reponse du proxy" ;;
    *)   soft "POST /api/auth/google -> HTTP $http_code_v" ;;
  esac

  verify_google_bundle "$client_id"

  # Origines JavaScript declenchees seulement si l'utilisateur a choisi cette
  # verification ; il n'y a volontairement AUCUN appel a Google ici.
  if is_true "$(read_env_value USWAP_CHECK_GOOGLE_ORIGIN false)"; then
    local origin
    origin="$(norm_url "$(read_env_value PUBLIC_APP_URL)")"
    local code_v
    code_v="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -I -k "${origin}/" 2>/dev/null || true)"
    code_v="$(norm_code "$code_v")"
    info "origine publique ${origin} : HTTP $code_v"
  fi
}

verify_connectivity() {
  step "Parcours A/B — verification des connexions"
  local fails_before=$count_fail
  verify_password_login
  verify_google_login
  # LE TEST QUI REPRODUIT LE NAVIGATEUR. curl accepte un cookie Secure en
  # HTTP, un navigateur non : sans cette simulation, le script declarait
  # « OK » alors que l'utilisateur ne pouvait pas se connecter.
  # Execute uniquement si un compte est testable (mot de passe reel).
  if ! is_placeholder "$(read_env_value SUPERADMIN_PASSWORD)" \
     && ! printf '%s' "$(read_env_value SUPERADMIN_PASSWORD)" | grep -q "Demo"; then
    verify_browser_session
  else
    soft "simulation navigateur ignoree : SUPERADMIN_PASSWORD est un modele"
  fi
  # Toute anomalie du parcours A est aussi une anomalie de connexion : sans ce
  # marquage, un 403/404 produirait le code generique 1 au lieu de 6.
  [ "$count_fail" -eq "$fails_before" ] || mark_login
}

# =============================================================================
#  SECTION H — REPARATIONS CIBLEES (--repair, etapes internes de --deploy)
# =============================================================================
#  Chaque reparation est IDEMPOTENTE et se limite au perimetre uSwap. Aucune
#  ne supprime de volume, de base, ni ne reecrit un secret.
# =============================================================================

repair_act() {
  local message="$1"
  ACTION_COUNT=$((ACTION_COUNT + 1))
  ACTION_LIST+=("$message")
  pass "$message"
}

repair_env_permissions() {
  local perms
  [ -f "$ENV_FILE" ] || return 0
  perms="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')"
  if [ "$perms" != "600" ]; then
    if [ "$(id -u)" -eq 0 ] && chmod 600 "$ENV_FILE" 2>/dev/null; then
      repair_act "deploy/.env : permissions 600 (etait $perms)"
    else
      soft "permissions deploy/.env : $perms (chmod impossible sans root)"
    fi
  fi
}

# COOKIE_SECURE incoherent avec le canal public.
#
#   https + COOKIE_SECURE=false -> cookie transmis en clair : faille, mais
#                                  connexion fonctionnelle ; on signale.
#   http  + COOKIE_SECURE=true  -> navigateur qui IGNORE le cookie :
#                                  connexion impossible. C'est la panne
#                                  vecue au dernier deploiement.
#
# La correction appliquee est la SEULE qui ne degrade pas la securite :
# basculer COOKIE_SECURE=false quand le site est reellement servi en HTTP,
# pendant que l'acces passe en HTTPS le jour ou le certificat est en place.
# Aucune valeur n'est ecrite si le site est deja en HTTPS.
repair_cookie_scheme() {
  local scheme current
  [ -f "$ENV_FILE" ] || return 0
  scheme="$(public_scheme)"
  current="$(read_env_value COOKIE_SECURE true)"

  case "$scheme:$(is_true "$current" && echo true || echo false)" in
    http:true)
      # Ecriture ciblee : une seule ligne modifiee, le reste du fichier intact.
      if grep -qE '^[[:space:]]*COOKIE_SECURE[[:space:]]*=' "$ENV_FILE"; then
        sed -i 's|^[[:space:]]*COOKIE_SECURE[[:space:]]*=.*|COOKIE_SECURE=false|' "$ENV_FILE"
      else
        printf '\nCOOKIE_SECURE=false\n' >> "$ENV_FILE"
      fi
      repair_act "deploy/.env : COOKIE_SECURE=false (site en HTTP ; le cookie Secure etait rejete par le navigateur)"
      ;;
    https:false)
      soft "COOKIE_SECURE=false alors que le site est en HTTPS : le cookie circule sans protection"
      info "remettre COOKIE_SECURE=true dans deploy/.env : la connexion fonctionne sans lui"
      ;;
    *)
      pass "COOKIE_SECURE coherent avec le canal (${scheme})"
      ;;
  esac
  return 0
}

# Volume commun : ecrit par le backend (UID node = 1000). Un dossier racine
# au proprietaire root provoquait des EACCES sur les pieces jointes ; sans
# rapport avec la connexion, mais reparable sans risque. Corrige seulement
# si le conteneur backend existe.
repair_uploads_dir() {
  [ "$(health_of backend)" = "absent" ] && return 0
  local owner
  owner="$(compose exec -T backend sh -c 'stat -c %u /app/var/uploads 2>/dev/null' 2>/dev/null | tr -d '\r' || true)"
  if [ -n "$owner" ] && [ "$owner" != "1000" ]; then
    if compose exec -T -u root backend chown -R node:node /app/var/uploads >/dev/null 2>&1; then
      repair_act "volume uswap-uploads : proprietaire remis a node (etait UID $owner)"
    else
      soft "volume uswap-uploads : proprietaire UID $owner non corrigeable"
    fi
  fi
}

# Base absente : `CREATE DATABASE` ne touche qu'a une base inexistante. Aucune
# base existante n'est modifiee, aucun DROP n'est jamais emis.
repair_postgres_database() {
  local user db exists
  user="$(read_env_value POSTGRES_USER uswap)"
  db="$(read_env_value POSTGRES_DB uswap)"

  if [ "$(health_of db)" = "absent" ]; then
    soft "PostgreSQL non demarree : creation de base reportee au deploiement"
    return 0
  fi

  exists="$(compose exec -T db psql -U "$user" -d postgres -tAc \
    "select 1 from pg_database where datname='${db}';" 2>/dev/null | tr -d ' \r' || true)"
  if [ "$exists" = "1" ]; then
    pass "base PostgreSQL '${db}' presente"
  else
    if compose exec -T db psql -U "$user" -d postgres -tAc "CREATE DATABASE \"${db}\";" >/dev/null 2>&1; then
      repair_act "base PostgreSQL '${db}' creee (elle n'existait pas)"
    else
      fail_domain network "creation de la base '${db}' impossible (utilisateur $user sans privileges ?)"
    fi
  fi
}

repair_migrations() {
  if [ "$(health_of db)" = "absent" ]; then
    soft "PostgreSQL non demarree : migrations reportees"
    return 0
  fi
  local status output
  set +e
  output="$(compose_tools migrate status 2>&1)"
  status=$?
  set -e
  if [ "$status" -ne 0 ]; then
    fail_domain network "migrate status a echoue : migrations non appliquees"
    printf '%s\n' "$output" | sed 's/^/        /' | tail -n 15
    return 0
  fi

  if printf '%s' "$output" | grep -qiE "up to date|No pending migrations"; then
    pass "migrations deja a jour"
    return 0
  fi

  sub "Application des migrations versionnees (migrate deploy, strictement additif)"
  if compose_tools migrate; then
    repair_act "migrations appliquees (migrate deploy)"
  else
    fail_domain network "migrate deploy a echoue : schema inchange, voir la sortie ci-dessus"
    info "ne JAMAIS utiliser migrate reset / db push en production"
  fi
}

repair_bootstrap() {
  # Idempotent : cree ce qui manque (stations, modeles, super administrateur),
  # ne reecrit jamais un mot de passe existant, ne supprime rien.
  if [ "$(health_of db)" = "absent" ]; then
    soft "PostgreSQL non demarree : bootstrap reporte"
    return 0
  fi
  sub "Referentiel et super administrateur (bootstrap idempotent)"
  if compose_tools bootstrap; then
    repair_act "bootstrap joue (referentiel + compte super administrateur)"
  else
    fail_domain network "bootstrap en echec (compte existant conserve, voir la sortie ci-dessus)"
  fi
}

# Une image anterieure au code courant donne un 404 sur des routes recentes
# (/auth/login/:role par exemple). Comparaison code source <-> image.
repair_stale_backend_route() {
  [ "$(health_of backend)" = "absent" ] && return 0
  local code_v
  code_v="$(http_code "http://127.0.0.1:${BACKEND_PORT}/auth/login/superadmin")"
  # GET sur une route POST : 404 = pas montee, 405/400 = montee.
  if [ "$code_v" = "404" ]; then
    repair_act "route /auth/login/:role absente de l'image backend : reconstruction demandee"
    IMAGE_REBUILD_NEEDED=1
  fi
}

# VirtualHost divergent (port deplace, domaine change) : sauvegarde puis
# reecriture, et rechargement UNIQUEMENT si `configtest` passe.
repair_apache_site() {
  if ! have apache2ctl || [ ! -f "$APACHE_CONF" ]; then
    return 0
  fi
  local expected_port="$FRONTEND_PORT"
  if [ -f "$APACHE_TARGET" ] && grep -qF "127.0.0.1:${expected_port}" "$APACHE_TARGET" 2>/dev/null; then
    return 0
  fi

  if [ ! -f "$APACHE_CONF" ]; then
    return 0
  fi

  local domain="${PUBLIC_DOMAIN:-uswap.example.org}"
  if [ -f "$APACHE_TARGET" ]; then
    local backup="$APACHE_TARGET.bak-$(date +%Y%m%d-%H%M%S)"
    if cp "$APACHE_TARGET" "$backup"; then
      info "sauvegarde : $backup"
    fi
  fi

  if sed -e "s|uswap\.example\.org|${domain}|g" \
         -e "s|127\.0\.0\.1:8080|127.0.0.1:${expected_port}|g" \
         "$APACHE_CONF" > "$APACHE_TARGET.new" 2>/dev/null; then
    mv "$APACHE_TARGET.new" "$APACHE_TARGET"
    repair_act "VirtualHost Apache reecrit pour ${domain} -> 127.0.0.1:${expected_port}"
  else
    rm -f "$APACHE_TARGET.new"
    fail_domain network "ecriture du VirtualHost Apache impossible"
    return 0
  fi
}

repair_apache_enable() {
  if ! have apache2ctl; then
    return 0
  fi
  local site
  site="$(basename "$APACHE_TARGET" .conf)"
  local changed=0

  if ! a2query -m proxy >/dev/null 2>&1 || ! a2query -m proxy_http >/dev/null 2>&1; then
    if a2enmod proxy proxy_http headers ssl rewrite >/dev/null 2>&1; then
      changed=1
      info "modules Apache actives (proxy, proxy_http, headers, ssl, rewrite)"
    fi
  fi
  if [ ! -L "/etc/apache2/sites-enabled/$site.conf" ]; then
    if a2ensite "$site" >/dev/null 2>&1; then
      changed=1
      info "site $site active (a2ensite)"
    fi
  fi

  # Apache ne doit jamais etre recharge si sa configuration est invalide :
  # les autres sites de production continueraient de tourner, mais un reload
  # rate cacherait l'erreur.
  if ! apache2ctl configtest >/dev/null 2>&1; then
    fail_domain network "apache2ctl configtest en echec : Apache NON recharge (les autres sites restent en service)"
    apache2ctl configtest 2>&1 | sed 's/^/        /' | head -n 10 || true
    return 0
  fi

  if [ "$changed" -eq 1 ]; then
    if systemctl reload apache2 >/dev/null 2>&1 || apache2ctl graceful >/dev/null 2>&1; then
      repair_act "Apache recharge (configtest OK, autres sites intacts)"
    else
      soft "Apache n'a pas pu etre recharge (systemctl indisponible ?)"
    fi
  else
    pass "Apache deja coherent (aucun rechargement necessaire)"
  fi
}

run_repairs() {
  step "5/10  Reparations ciblees (sures et idempotentes)"
  IMAGE_REBUILD_NEEDED=0
  # Signale qu'une variable du .env a change : le conteneur backend doit etre
  # RECREE (pas seulement redemarre) pour la relire. `up -d` le fait de toute
  # facon, mais ce drapeau rend l'intention explicite dans le rapport.
  ENV_CHANGED=0

  # 0. Le .env : permissions, et coherence COOKIE_SECURE <-> HTTP/HTTPS.
  #    Jamais les secrets, jamais les autres variables.
  repair_env_permissions
  local cookie_before
  cookie_before="$(read_env_value COOKIE_SECURE true)"
  repair_cookie_scheme
  [ "$cookie_before" = "$(read_env_value COOKIE_SECURE true)" ] || ENV_CHANGED=1

  # 1. Les services doivent exister : db d'abord (les outils en dependent).
  if [ "$(health_of db)" = "absent" ]; then
    sub "Demarrage de PostgreSQL (necessaire aux reparations suivantes)"
    compose up -d db >/dev/null
    if [ "$(wait_for_healthy db "$WAIT_DB_TIMEOUT")" = "healthy" ]; then
      pass "PostgreSQL healthy"
    else
      fail_domain network "PostgreSQL ne demarre pas"
      last_logs db 80
      return 0
    fi
  fi

  # 2. Base + migrations + referentiel (ordre impose).
  repair_postgres_database
  repair_migrations
  repair_bootstrap

  # 3. Image backend perimee (route absente).
  repair_stale_backend_route

  # NOTE : repair_uploads_dir() est volontairement ABSENTE ici. Elle interroge
  # le conteneur backend, qui n'est pas encore demarre a cette etape : appelee
  # ici, son garde `health_of backend == absent` la faisait sortir sans rien
  # faire. Elle est donc appelee depuis deploy_services(), APRES le demarrage.

  # 4. Apache (VirtualHost + activation + reload conditionnel).
  if [ -f "$APACHE_CONF" ] && have apache2ctl; then
    repair_apache_site
    repair_apache_enable
  fi
}
# =============================================================================
#  SECTION I — DEPLOIEMENT (--deploy)
# =============================================================================

# Une image n'est reconstruite que si necessaire — sauf en mode --deploy, ou
# la reconstruction est FORCEE : le superviseur ne tape qu'une commande, et
# un `git pull` suivi de --deploy doit toujours livrer le code recupere. Le
# cache de Docker rend les reconstructions suivantes rapides (seules les
# couches dont les sources ont change sont rejouees).
image_is_stale() {
  local service="$1"
  local id image_created newest_source dir

  id="$(compose ps -q "$service" 2>/dev/null | head -n 1 || true)"
  if [ -z "$id" ]; then
    # Pas de conteneur : l'image peut exister sans tourner.
    id="$(docker images --format '{{.Repository}}:{{.Tag}}' "uswap/${service}:*" 2>/dev/null | head -n 1 || true)"
    [ -n "$id" ] || return 0
    image_created="$(docker inspect -f '{{.Created}}' "$id" 2>/dev/null || true)"
  else
    image_created="$(docker inspect -f '{{.Created}}' "$id" 2>/dev/null || true)"
  fi
  [ -n "$image_created" ] || return 0

  case "$service" in
    backend) dir="$BACKEND_DIR" ;;
    frontend) dir="$FRONTEND_DIR" ;;
    *) return 1 ;;
  esac

  newest_source="$(find "$dir" -type f \
     \( -name '*.ts' -o -name '*.tsx' -o -name '*.json' -o -name 'Dockerfile' \
        -o -name '*.prisma' -o -name '*.sql' -o -name '*.conf' -o -name '*.html' -o -name '*.css' \) \
     -not -path '*/node_modules/*' -not -path '*/dist/*' -printf '%T@\n' 2>/dev/null \
     | sort -nr | head -n 1 || true)"
  [ -n "$newest_source" ] || return 1

  if awk -v src="$newest_source" -v img="$(date -d "$image_created" +%s 2>/dev/null || echo 0)" \
       'BEGIN { exit (src > img + 1) ? 0 : 1 }'; then
    return 0
  fi
  return 1
}

deploy_build() {
  step "6/10  Construction des images"
  local targets=()

  if [ "$FORCE_BUILD" -eq 1 ] || [ "${IMAGE_REBUILD_NEEDED:-0}" -eq 1 ]; then
    targets=(backend frontend)
    if [ "${IMAGE_REBUILD_NEEDED:-0}" -eq 1 ]; then
      info "image backend obsolete (route /auth/login/:role absente) : reconstruction des deux images"
    else
      info "reconstruction des deux images (--deploy garantit que le code du depot est celui qui tourne ; --check/--repair ne reconstruisent pas)"
    fi
  else
    if image_is_stale backend; then
      targets+=(backend)
    fi
    if image_is_stale frontend; then
      targets+=(frontend)
    fi
    if [ "${#targets[@]}" -eq 0 ]; then
      pass "images a jour (aucune source plus recente) : construction ignoree"
      return 0
    fi
    info "sources plus recentes que l'image : ${targets[*]}"
  fi

  local target
  for target in "${targets[@]}"; do
    sub "Build $target (plusieurs minutes au premier lancement)"
    if compose build "$target"; then
      pass "image $target construite"
    else
      fail_domain network "build $target en echec"
      info "relire le message de npm/tsc ci-dessus. Rappel : les Dockerfiles"
      info "epinglent npm 10.9.2 ; un cache ancien se corrige par --rebuild."
      return 1
    fi
  done
}

deploy_database() {
  step "7/10  PostgreSQL, migrations et referentiel"
  sub "Demarrage de db"
  compose up -d db >/dev/null
  local status
  status="$(wait_for_healthy db "$WAIT_DB_TIMEOUT")"
  if [ "$status" != "healthy" ]; then
    fail_domain network "PostgreSQL non healthy ($status)"
    last_logs db 80
    return 1
  fi
  pass "PostgreSQL healthy"

  repair_postgres_database
  # `migrate` et `bootstrap` utilisent l'image backend : la plus recente doit
  # etre construite avant.
  repair_migrations
  repair_bootstrap

  if [ "$count_fail" -gt 0 ]; then
    return 1
  fi
}

deploy_services() {
  step "8/10  Demarrage du backend et du frontend"
  sub "docker compose up -d backend frontend"
  if ! compose up -d backend frontend; then
    fail_domain network "demarrage backend/frontend refuse par Compose"
    compose ps || true
    last_logs backend 120
    last_logs frontend 60
    return 1
  fi

  local be_status fe_status
  be_status="$(wait_for_healthy backend "$WAIT_BACKEND_TIMEOUT")"
  if [ "$be_status" != "healthy" ]; then
    fail_domain network "backend non healthy ($be_status) : c'est la cause directe du 502"
    last_logs backend 120
    diagnose_backend_logs
    return 1
  fi
  pass "backend healthy"

  # Volume uswap-uploads : le backend doit tourner pour y acceder. C'est LE
  # seul endroit correct pour cette reparation (voir la note dans run_repairs).
  repair_uploads_dir

  fe_status="$(wait_for_healthy frontend "$WAIT_FRONTEND_TIMEOUT")"
  if [ "$fe_status" != "healthy" ]; then
    fail_domain network "frontend non healthy ($fe_status)"
    last_logs frontend 80
    return 1
  fi
  pass "frontend healthy"
}

deploy_apache() {
  sub "Apache — reverse proxy de l'hote (VirtualHost, configtest, reload)"
  if [ ! -f "$APACHE_CONF" ]; then
    soft "$APACHE_CONF absent : Apache non configure"
    return 0
  fi
  if ! have apache2ctl; then
    soft "Apache non installe : application joignable en local sur 127.0.0.1:${FRONTEND_PORT}"
    return 0
  fi
  repair_apache_site
  repair_apache_enable
  return 0
}

run_deploy() {
  run_checks
  if [ "$count_fail" -gt 0 ]; then
    # Pas de `die` ici : le rapport final doit quand meme etre affiche, sinon
    # le superviseur ne recoit qu'un message sec sans recapitulatif. Le code
    # de sortie reste non nul grace a `failure_exit_code`.
    soft "controles en echec : arret AVANT toute modification du serveur"
    return 1
  fi

  diagnose
  sub "Synthese du diagnostic"
  if [ "$count_fail" -gt 0 ]; then
    soft "anomalies detectees : les reparations sures ciblent les cas reconnus"
  else
    pass "aucune anomalie detectee"
  fi

  # Les reparations s'appliquent malgre les anomalies du diagnostic : c'est
  # leur role. Une erreur APPARUE pendant la reparation (count_fail augmente)
  # n'empeche pas la suite : reconstruire peut justement la corriger.
  run_repairs

  # Chaque phase retourne 1 en cas d'echec bloquant ; on s'arrete a la
  # premiere, mais le rapport final est TOUJOURS affiche (voir main).
  deploy_build || { fail_domain network "build des images en echec : arret"; return 1; }
  deploy_database || { fail_domain network "base de donnees non prete : arret"; return 1; }
  deploy_services || { fail_domain network "services non prets : 502 maintenu"; return 1; }

  step "9/10  Tests de disponibilite, Apache et connexions"

  sub "9a — tests HTTP a travers le proxy Nginx"
  local home_code session_code spa_code
  home_code="$(http_code "http://127.0.0.1:${FRONTEND_PORT}/")"
  session_code="$(http_code "http://127.0.0.1:${FRONTEND_PORT}/api/auth/session")"
  spa_code="$(http_code "http://127.0.0.1:${FRONTEND_PORT}/app/admin")"
  printf '  %-46s %s\n' "page d'accueil (200 attendu)" "$home_code"
  printf '  %-46s %s\n' "session anonyme (204 attendu)" "$session_code"
  printf '  %-46s %s\n' "route SPA /app/admin (200 attendu)" "$spa_code"
  [ "$home_code" = "200" ] || fail_domain network "le frontend ne sert pas l'application (HTTP $home_code)"
  case "$session_code" in
    204|401) pass "l'API repond derriere le proxy (HTTP $session_code)" ;;
    502)     fail_domain network "502 sur /api/auth/session : le backend n'est pas joint par Nginx" ;;
    *)       soft "l'API repond HTTP $session_code (204 attendu sans cookie)" ;;
  esac
  [ "$spa_code" = "200" ] || soft "route SPA /app/admin : HTTP $spa_code"

  sub "9b — Apache"
  deploy_apache

  sub "9c — parcours de connexion (e-mail/mot de passe, puis Google)"
  CONNECTION_CHECKS_RUN=1
  verify_connectivity

  step "10/10  Etat final"
  compose ps || true

  # Pas de `die` : main() affiche le rapport puis choisit le code de sortie.
  return 0
}

# =============================================================================
#  SECTION J — RAPPORT FINAL
# =============================================================================

final_report() {
  local title="$1"
  local public_url
  public_url="$(norm_url "$(read_env_value PUBLIC_APP_URL)")"

  printf '\n%s===============================================================%s\n' "$B" "$N"
  printf '%s  %s%s\n' "$B" "$title" "$N"
  printf '%s===============================================================%s\n' "$B" "$N"

  printf '  Controles reussis     : %s\n' "$count_ok"
  printf '  Avertissements        : %s\n' "$count_warn"
  printf '  Anomalies bloquantes  : %s\n' "$count_fail"

  if [ "$ACTION_COUNT" -gt 0 ]; then
    printf '\n  Actions appliquees (%s) :\n' "$ACTION_COUNT"
    local action
    for action in "${ACTION_LIST[@]}"; do
      printf '    - %s\n' "$action"
    done
  else
    printf '\n  Actions appliquees : aucune\n'
  fi

  printf '\n  Acces\n'
  printf '    local      : http://127.0.0.1:%s\n' "${FRONTEND_PORT:-8080}"
  printf '    public     : %s\n' "${public_url:-<PUBLIC_APP_URL>}"
  printf '    compte     : %s\n' "$(read_env_value SUPERADMIN_EMAIL)"
  printf '    mot de passe : SUPERADMIN_PASSWORD de deploy/.env (jamais affiche)\n'

  local google_id
  google_id="$(read_env_value GOOGLE_CLIENT_ID)"
  printf '\n  Connexions\n'
  if [ "${CONNECTION_CHECKS_RUN:-0}" -eq 1 ]; then
    printf '    e-mail + mot de passe : verifie ci-dessus (Parcours A)\n'
    if [ -n "$google_id" ]; then
      printf '    Google                : verifie ci-dessus (Parcours B, non-regression)\n'
    else
      printf '    Google                : non configure (bouton masque)\n'
    fi
  else
    printf '    e-mail + mot de passe : NON VERIFIE dans cette execution (voir motif ci-dessus)\n'
    printf '    Google                : NON VERIFIE dans cette execution\n'
  fi
  printf '    notifications Web Push: desactivees (DISABLE_WEB_PUSH=true dans Compose)\n'

  printf '\n  Commandes utiles\n'
  printf '    etat          : sudo docker compose -f %s --env-file %s ps\n' "$COMPOSE_FILE" "$ENV_FILE"
  printf '    journaux API  : sudo docker compose -f %s --env-file %s logs -f backend\n' "$COMPOSE_FILE" "$ENV_FILE"
  printf '    diagnostic    : sudo bash deploy/deploy.sh --diagnose\n'
  printf '    reparation    : sudo bash deploy/deploy.sh --repair\n'
  printf '    retour arriere: sudo bash deploy/rollback.sh --list\n'
  printf '\n  Journal de cette execution : %s\n' "$LOG_FILE"

  if [ "$count_fail" -gt 0 ]; then
    printf '\n%s  RESULTAT : ECHEC (%s anomalie(s))%s\n\n' "$R" "$count_fail" "$N"
  elif [ "$count_warn" -gt 0 ]; then
    printf '\n%s  RESULTAT : OK avec %s avertissement(s)%s\n\n' "$Y" "$count_warn" "$N"
  else
    printf '\n%s  RESULTAT : OK%s\n\n' "$G" "$N"
  fi
}

# =============================================================================
#  SECTION K — POINT D'ENTREE
# =============================================================================

diagnose() {
  step "4/10  Diagnostic approfondi"
  local fails_before=$count_fail
  diagnose_containers
  diagnose_database
  if [ "$count_fail" -gt 0 ]; then
    soft "mesures suivantes limitees : base indisponible"
  fi
  diagnose_backend_logs
  diagnose_backend_reachability
  diagnose_routers
  diagnose_migrations
  diagnose_superadmin_account
  pass "diagnostic termine ($((count_fail - fails_before)) anomalie(s) sur cette section)"
}

main() {
  parse_args "$@"

  printf '%s\n' "uSwap — mode : --$MODE"
  printf 'Depot : %s\n' "$ROOT_DIR"
  printf 'Journal : %s\n' "$LOG_FILE"

  case "$MODE" in
    check)
      run_checks
      final_report "CONTROLE TERMINE — aucun changement applique"
      exit "$(failure_exit_code)"
      ;;
    diagnose)
      run_checks
      diagnose
      CONNECTION_CHECKS_RUN=1
      verify_connectivity
      final_report "DIAGNOSTIC TERMINE — aucun changement applique"
      exit "$(failure_exit_code)"
      ;;
    repair)
      run_checks
      if [ "$count_fail" -gt 0 ]; then
        diagnose
      fi
      run_repairs
      if [ "$(health_of backend)" != "absent" ]; then
        # Le backend tourne : la reparation du volume est desormais mesurable.
        repair_uploads_dir
      fi
      if [ "$(health_of backend)" != "absent" ] && [ "$(health_of frontend)" != "absent" ]; then
        CONNECTION_CHECKS_RUN=1
        verify_connectivity
      else
        soft "services non demarres : parcours de connexion non verifies (utiliser --deploy)"
      fi
      final_report "REPARATIONS TERMINEES"
      exit "$(failure_exit_code)"
      ;;
    deploy)
      # run_deploy retourne 1 des qu'une phase bloquante echoue, mais le
      # rapport est TOUJOURS affiche : le superviseur voit ce qui a reussi,
      # ce qui a echoue et pourquoi, puis le code de sortie tranche.
      run_deploy || true
      if [ "$count_fail" -gt 0 ]; then
        final_report "DEPLOIEMENT INCOMPLET"
      else
        final_report "DEPLOIEMENT TERMINE"
      fi
      exit "$(failure_exit_code)"
      ;;
  esac
}

main "$@"
