#!/usr/bin/env bash
# =============================================================================
# uSwap — deploiement automatise (une seule commande).
#
#   sudo bash deploy/deploy.sh              # deploiement complet
#   sudo bash deploy/deploy.sh --check      # controle seul, ne modifie rien
#   sudo bash deploy/deploy.sh --no-apache  # sans toucher a Apache
#   bash deploy/deploy.sh --help            # affiche ce document
#
# Le script est IDEMPOTENT : on peut le relancer, il ne casse rien.
# Il ne supprime JAMAIS de volume Docker, de base ni de donnee.
# Il n'ecrase JAMAIS un deploy/.env existant.
#
# -----------------------------------------------------------------------------
# 1. ARCHITECTURE
# -----------------------------------------------------------------------------
#
#   Internet
#     │  HTTPS (443)
#     ▼
#   Apache de l'hote  ──►  127.0.0.1:8080  ──►  conteneur frontend (Nginx :80)
#     (deploy/apache/uswap.conf)                 ├── /            → index.html (SPA React)
#                                                └── /api/xxx     → backend:3000/xxx
#                                                                     │
#                                                                     ▼
#                                                              db:5432 (PostgreSQL 16)
#
#   Services Docker (projet Compose « uswap ») :
#     db        postgres:16-alpine   volume uswap-pgdata   (aucun port publie)
#     backend   node:22 (NestJS)     127.0.0.1:3000        volume uswap-uploads
#     frontend  nginx:1.27-alpine    127.0.0.1:8080
#     migrate   profil « tools »     prisma migrate deploy (manuel)
#     bootstrap profil « tools »     referentiel + super administrateur (manuel)
#
#   Reseau dedie : uswap-internal. Aucun nom partage avec les autres
#   applications du serveur.
#
#   Sources (depot) :
#     backend_new/                 API NestJS + prisma/ (schema + migrations)
#     frontend_new/frontend/       React 19 + Vite 6, servi par Nginx
#     deploy/compose.yaml          orchestration
#     deploy/.env                  secrets (JAMAIS versionne, chmod 600)
#     deploy/apache/uswap.conf     VirtualHost Apache (installe manuellement)
#     deploy/rollback.sh           retour arriere
#     deploy/README_DEPLOYMENT.md  guide du superviseur
#
# -----------------------------------------------------------------------------
# 2. CE QUE FAIT CE SCRIPT (11 etapes)
# -----------------------------------------------------------------------------
#
#    1  Verification des prerequis du serveur (root, outils, ports)
#    2  Verification de Docker et Docker Compose
#    3  Verification des variables obligatoires de deploy/.env
#    4  Construction des images backend et frontend
#    5  Demarrage de PostgreSQL
#    6  Migrations Prisma (migrate deploy, strictement additif)
#    7  Referentiel + super administrateur (bootstrap, idempotent)
#    8  Demarrage du backend et du frontend
#    9  Verification de l'etat des conteneurs (healthy)
#   10  Tests de disponibilite (frontend, API, route SPA)
#   11  Configuration Apache (optionnelle, avec sauvegarde et configtest)
#
# -----------------------------------------------------------------------------
# 3. QUEL FICHIER .env ? (les trois sont DIFFERENTS)
# -----------------------------------------------------------------------------
#
#   deploy/.env                  PRODUCTION (Docker). LE SEUL FICHIER A
#                                REMPLIR POUR DEPLOYER. Cree a l'etape 3.
#
#   backend_new/.env             DEVELOPPEMENT LOCAL (npm run start:dev).
#                                N'entre JAMAIS dans l'image Docker.
#
#   frontend_new/frontend/.env   DEVELOPPEMENT LOCAL (npm run dev).
#                                N'entre JAMAIS dans l'image Docker.
#
#   ATTENTION : les valeurs de deploy/.env.example sont des MODELES. C'est
#   deploy/.env (cree a l'etape 3) qui est lu par Docker.
#
# -----------------------------------------------------------------------------
# 4. CE QU'IL FAUT REMPLIR DANS deploy/.env
# -----------------------------------------------------------------------------
#
#   --- 4.1 DEJA FOURNI : recopier tel quel --------------------------------
#
#     SUPERADMIN_EMAIL=itadmin@upowa.org
#     SUPERADMIN_PASSWORD=Uswap2026!Demo        (a changer avant production)
#     SUPERADMIN_FULLNAME=Super administrateur
#
#     MAIL_DRIVER=smtp
#     SMTP_HOST=smtp.gmail.com
#     SMTP_PORT=587
#     SMTP_SECURE=false
#     SMTP_REQUIRE_TLS=false
#     SMTP_USER=<adresse d'expedition de l'organisation>
#     SMTP_PASS=<mot de passe d'application de cette adresse>
#     MAIL_FROM=uSwap <la MEME adresse que SMTP_USER>
#
#     SMS_DRIVER=console                        (NE PAS CHANGER : aucun envoi)
#     SMS_ENDPOINT=                             (vide)
#     SMS_TOKEN=                                (vide)
#
#   --- 4.2 A FOURNIR PAR LE SUPERVISEUR -----------------------------------
#
#     PUBLIC_APP_URL=https://<domaine-reel>
#     CORS_ORIGIN=https://<domaine-reel>        (identique a PUBLIC_APP_URL)
#
#     GOOGLE_CLIENT_ID=449904699288-xxxxxxxx.apps.googleusercontent.com
#
#       La valeur COMPLETE est necessaire : elle se termine par
#       « .apps.googleusercontent.com ». Le seul nombre 449904699288 est le
#       numero de PROJET Google Cloud, pas l'identifiant client.
#       Ou la trouver : console Google Cloud -> APIs et services ->
#       Identifiants -> client OAuth « Application Web » -> « ID client ».
#
#       Le « client secret » n'est PAS utilise : uSwap verifie un id_token
#       Google cote backend (Google Identity Services), sans echange de code.
#
#       Origines a declarer dans la console Google Cloud (sinon
#       « origin_mismatch ») :
#         https://<domaine-reel>
#         http://localhost:5173
#
#     ADMIN_BOOTSTRAP_PASSWORD=<mot de passe fort>
#       Applique UNIQUEMENT a un compte ADMIN trouve desactive au demarrage.
#
#   --- 4.3 GENERE AUTOMATIQUEMENT PAR CE SCRIPT ---------------------------
#
#     POSTGRES_PASSWORD          openssl rand -hex 24
#     JWT_SECRET                 openssl rand -base64 48
#     JWT_REFRESH_SECRET         openssl rand -base64 48
#
#   --- 4.4 FACULTATIF : laisser vide --------------------------------------
#
#     VITE_GOOGLE_MAPS_API_KEY=   vide = carte sur OpenStreetMap (fonctionnel)
#     ADMIN_EMAIL= / ADMIN_PASSWORD=   aucun second administrateur cree
#
# -----------------------------------------------------------------------------
# 5. APRES LE DEPLOIEMENT
# -----------------------------------------------------------------------------
#
#   - Apache : installer deploy/apache/uswap.conf (voir README_DEPLOYMENT.md)
#   - Verifier https://<domaine>/            → ecran de connexion
#   - Verifier https://<domaine>/api/auth/session → 401 JSON
#   - Se connecter avec SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
#   - Creer les stations : adresse, coordonnees GPS ou « Utiliser ma position »
#   - Sauvegardes : pg_dump + volume uswap-uploads (README_DOCKER.md §9)
#
# -----------------------------------------------------------------------------
# 6. DIAGNOSTIC : « LE SYSTEME EST MOMENTANEMENT INDISPONIBLE »
# -----------------------------------------------------------------------------
#
#   Symptome : le login repond 502 (Bad Gateway) et l'ecran affiche
#   « Le systeme est momentanement indisponible ».
#
#   Un 502 vient TOUJOURS du proxy (Nginx du conteneur frontend, ou Apache) :
#   la requete /api/auth/login/... a ete transmise a « backend:3000 » et n'a
#   pas obtenu de reponse. Le conteneur backend est arrete, en redemarrage, ou
#   a plante au demarrage.
#
#   Verification en 1 commande (etat + 40 dernieres lignes) :
#     docker compose -f deploy/compose.yaml --env-file deploy/.env ps
#     docker compose -f deploy/compose.yaml --env-file deploy/.env logs --tail=40 backend
#
#   Causes frequentes et correction :
#
#     1) backend « restarting » ou « exited » au demarrage
#        -> les journaux indiquent la variable manquante (P1001 = base
#           injoignable, « JWT_SECRET » = secret absent, Prisma P2021 =
#           migrations non appliquees). Corriger deploy/.env, puis :
#             docker compose ... up -d backend
#
#     2) migrations jamais appliquees (base neuve)
#        -> rejouer l'etape 6 :
#             docker compose ... --profile tools run --rm migrate
#
#     3) image backend construite depuis un contexte incomplet
#        -> reconstruire sans cache :
#             docker compose ... build --no-cache backend
#             docker compose ... up -d --force-recreate backend
#
#     4) test direct du backend, sans passer par le proxy :
#             docker compose ... exec -T backend \
#               node -e "fetch('http://127.0.0.1:3000/auth/session').then(r=>console.log(r.status))"
#        - 204 ou 401 : le backend va bien, le probleme est le reseau Docker
#          entre frontend et backend (verifier qu'ils sont sur le meme reseau
#          uswap-internal : docker compose ... ps).
#        - erreur de connexion : le backend ne tourne pas (cause 1).
#
#   Google : « The given client ID is not found » (403 sur accounts.google.com)
#     -> GOOGLE_CLIENT_ID est incomplet ou provient d'un autre projet. La valeur
#        exacte se termine par « .apps.googleusercontent.com » (section 4.2).
#        La connexion par e-mail et mot de passe reste utilisable.
#
#   « Banner not shown: beforeinstallpromptevent.preventDefault() called »
#     -> message informatif du navigateur sur l'installation de la PWA, sans
#        effet sur la connexion. Aucune action requise.
#
#   npm : « Cannot read properties of null (reading 'edgesOut') »
#     -> npm 11 reconstruit l'arbre de dependances differemment de npm 10 et
#        echoue sur un lockfile produit par npm 10. Les Dockerfiles epinglent
#        npm 10.9.2 ; si l'erreur revient, verifier que l'image n'a pas ete
#        construite depuis un cache ancien :
#             docker compose ... build --no-cache frontend backend
#
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

MODE="deploy"
APACHE=1
for arg in "$@"; do
  case "$arg" in
    --help|-h) sed -n '2,215p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    --check)   MODE="check" ;;
    --no-apache) APACHE=0 ;;
    *)         die "option inconnue : $arg (utiliser --help, --check, --no-apache)" ;;
  esac
done

# Garde-fou : aucune commande destructive ne peut passer par ce script.
compose() {
  case "$*" in
    *down*-v*|*"down --volumes"*|*reset*|*"db push"*|*"migrate dev"*)
      die "Commande destructive refusee par ce script : $*" ;;
  esac
  docker compose "${T[@]}" "$@"
}

# -----------------------------------------------------------------------------
step "1/11  Prerequis du serveur"
# -----------------------------------------------------------------------------
[ "$(id -u)" -eq 0 ] || warn "script lance sans sudo : Docker peut refuser l'acces"
for tool in curl openssl; do
  command -v "$tool" >/dev/null 2>&1 || die "$tool est requis (apt-get install -y $tool)"
done
ok "outils de base presents (curl, openssl)"

[ -f "$COMPOSE" ] || die "deploy/compose.yaml introuvable. Lancer ce script depuis la racine du depot."
for f in frontend_new/frontend/Dockerfile \
         frontend_new/frontend/deploy/nginx.conf \
         frontend_new/frontend/package-lock.json \
         backend_new/Dockerfile \
         backend_new/package-lock.json \
         backend_new/prisma/schema.prisma; do
  [ -f "$f" ] || die "fichier manquant : $f (depot incomplet)"
done
MIG_COUNT=$(find backend_new/prisma/migrations -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
[ "$MIG_COUNT" -gt 0 ] || die "aucune migration dans backend_new/prisma/migrations/"
ok "sources completes — $MIG_COUNT migration(s) Prisma"

if [ -d .git ]; then
  ok "depot Git : $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'inconnu') — $(git log --oneline -1 2>/dev/null)"
fi

# -----------------------------------------------------------------------------
step "2/11  Docker et Docker Compose"
# -----------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "Docker n'est pas installe (https://docs.docker.com/engine/install/ubuntu/)."
docker info >/dev/null 2>&1 || die "Le demon Docker ne repond pas. Essayer : sudo systemctl start docker"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 absent (plugin 'docker compose')."
ok "Docker $(docker --version | sed 's/Docker version //;s/,.*//') — $(docker compose version --short)"

# -----------------------------------------------------------------------------
step "3/11  Configuration (deploy/.env)"
# -----------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  if [ "$MODE" = "check" ]; then
    die "deploy/.env absent. Creer avec : cp deploy/.env.example deploy/.env && chmod 600 deploy/.env"
  fi
  [ -f deploy/.env.example ] || die "deploy/.env.example introuvable"
  cp deploy/.env.example "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  set_env() { # $1 = cle, $2 = valeur
    if grep -qE "^[[:space:]]*$1=" "$ENV_FILE"; then
      sed -i "s|^[[:space:]]*$1=.*|$1=$2|" "$ENV_FILE"
    else
      printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"
    fi
  }

  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env JWT_SECRET "$(openssl rand -base64 48 | tr -d '\r\n')"
  set_env JWT_REFRESH_SECRET "$(openssl rand -base64 48 | tr -d '\r\n')"
  set_env FRONTEND_BUILD_CONTEXT "..\/frontend_new\/frontend"
  set_env BACKEND_BUILD_CONTEXT "..\/backend_new"

  ok "deploy/.env cree (secrets aleatoires, permissions 600)"
  warn "renseigner la section 4 du guide : PUBLIC_APP_URL, CORS_ORIGIN,"
  warn "GOOGLE_CLIENT_ID, ADMIN_BOOTSTRAP_PASSWORD, SMTP_USER / SMTP_PASS"
else
  ok "deploy/.env existe — conserve tel quel (aucun secret ecrase)"
fi

PERMS="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')"
[ "$PERMS" = "600" ] && ok "permissions $PERMS" || warn "permissions $PERMS (attendu 600) : chmod 600 $ENV_FILE"

get_env() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | head -n1 | tr -d '\r"' ; }

PLACEHOLDERS=0
for key in POSTGRES_PASSWORD JWT_SECRET JWT_REFRESH_SECRET ADMIN_BOOTSTRAP_PASSWORD \
           SUPERADMIN_EMAIL SUPERADMIN_PASSWORD; do
  value="$(get_env "$key")"
  if [ -z "$value" ] || printf '%s' "$value" | grep -q 'CHANGER-'; then
    warn "$key non renseigne (valeur de modele)"
    PLACEHOLDERS=1
  fi
done
[ "$PLACEHOLDERS" = "0" ] && ok "secrets obligatoires renseignes"

PUBLIC_URL="$(get_env PUBLIC_APP_URL)"
case "$PUBLIC_URL" in
  https://*) ok "PUBLIC_APP_URL=$PUBLIC_URL (HTTPS)" ;;
  *example.org*) warn "PUBLIC_APP_URL encore sur le domaine de modele : $PUBLIC_URL" ;;
  *) warn "PUBLIC_APP_URL=$PUBLIC_URL — la geolocalisation exige HTTPS en production" ;;
esac

GOOGLE_ID="$(get_env GOOGLE_CLIENT_ID)"
if [ -n "$GOOGLE_ID" ]; then
  ok "connexion Google configuree (GOOGLE_CLIENT_ID)"
  case "$GOOGLE_ID" in
    *.apps.googleusercontent.com) ;;
    *) warn "GOOGLE_CLIENT_ID ne ressemble pas a un identifiant OAuth (attendu : ...apps.googleusercontent.com)" ;;
  esac
else
  warn "GOOGLE_CLIENT_ID vide : bouton « Se connecter avec Google » masque"
fi

if [ -n "$(get_env SMTP_USER)" ] && [ -n "$(get_env SMTP_PASS)" ]; then
  ok "e-mails SMTP configures ($(get_env SMTP_USER))"
else
  warn "SMTP_USER / SMTP_PASS vides : aucun e-mail ne sera envoye"
fi

[ "$(get_env SMS_DRIVER)" = "console" ] \
  && ok "SMS en mode console (aucun envoi, aucun cout)" \
  || warn "SMS_DRIVER=$(get_env SMS_DRIVER) : verifier que le fournisseur est bien configure"

[ -n "$(get_env VITE_GOOGLE_MAPS_API_KEY)" ] \
  && ok "carte Google Maps configuree (VITE_GOOGLE_MAPS_API_KEY)" \
  || warn "VITE_GOOGLE_MAPS_API_KEY vide : carte de creation sur OpenStreetMap"

compose config >/dev/null 2>&1 \
  && ok "configuration Compose valide" \
  || die "configuration invalide. Diagnostiquer avec : docker compose -f $COMPOSE --env-file $ENV_FILE config"

if [ "$MODE" = "check" ]; then
  printf '\n%s  CONTROLE TERMINE — aucun changement applique.%s\n' "$G" "$N"
  exit 0
fi

# -----------------------------------------------------------------------------
step "4/11  Construction des images (quelques minutes)"
# -----------------------------------------------------------------------------
compose build backend
compose build frontend
ok "images construites"

# -----------------------------------------------------------------------------
step "5/11  PostgreSQL"
# -----------------------------------------------------------------------------
compose up -d db
printf '  attente de PostgreSQL '
status="starting"
for _ in $(seq 1 40); do
  status="$(docker inspect -f '{{.State.Health.Status}}' uswap-db-1 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  printf '.'
  sleep 3
done
printf '\n'
[ "$status" = "healthy" ] || die "PostgreSQL n'est pas healthy (docker logs uswap-db-1)"
ok "PostgreSQL healthy"

# -----------------------------------------------------------------------------
step "6/11  Migrations Prisma"
# -----------------------------------------------------------------------------
# `migrate deploy` est strictement additif : il applique les migrations
# manquantes deja versionnees, sans jamais reinitialiser la base.
compose --profile tools run --rm migrate
ok "schema applique"

# -----------------------------------------------------------------------------
step "7/11  Referentiel et super administrateur"
# -----------------------------------------------------------------------------
# Idempotent : ne supprime rien et ne reecrit pas un mot de passe existant.
compose --profile tools run --rm bootstrap
ok "referentiel initialise"

# -----------------------------------------------------------------------------
step "8/11  Demarrage backend et frontend"
# -----------------------------------------------------------------------------
compose up -d backend frontend
printf '  attente des healthchecks '
BE="starting"; FE="starting"
for _ in $(seq 1 40); do
  BE="$(docker inspect -f '{{.State.Health.Status}}' uswap-backend-1 2>/dev/null || echo starting)"
  FE="$(docker inspect -f '{{.State.Health.Status}}' uswap-frontend-1 2>/dev/null || echo starting)"
  [ "$BE" = "healthy" ] && [ "$FE" = "healthy" ] && break
  printf '.'
  sleep 3
done
printf '\n'

# -----------------------------------------------------------------------------
step "9/11  Etat des conteneurs"
# -----------------------------------------------------------------------------
compose ps
[ "$BE" = "healthy" ] || die "backend non healthy (docker compose ... logs --tail=60 backend)"
[ "$FE" = "healthy" ] || die "frontend non healthy (docker compose ... logs --tail=60 frontend)"
ok "backend et frontend healthy"

# -----------------------------------------------------------------------------
step "10/11  Tests de disponibilite"
# -----------------------------------------------------------------------------
FE_PORT="$(get_env FRONTEND_HOST_PORT)"; FE_PORT="${FE_PORT:-8080}"
BASE="http://127.0.0.1:$FE_PORT"
code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || echo "000"; }

HOME_CODE="$(code "$BASE/")"
SESSION_CODE="$(code "$BASE/api/auth/session")"
SPA_CODE="$(code "$BASE/app/admin")"

printf '  %-42s %s\n' "page d'accueil (200 attendu)"      "$HOME_CODE"
printf '  %-42s %s\n' "session anonyme (401 attendu)"       "$SESSION_CODE"
printf '  %-42s %s\n' "route SPA /app/admin (200 attendu)"  "$SPA_CODE"

[ "$HOME_CODE" = "200" ] || die "le frontend ne repond pas (code $HOME_CODE)"
[ "$SESSION_CODE" = "401" ] || warn "l'API ne repond pas comme attendu (code $SESSION_CODE) : voir les journaux backend"
ok "application joignable"

# -----------------------------------------------------------------------------
step "11/11  Apache (optionnel)"
# -----------------------------------------------------------------------------
if [ "$APACHE" = "0" ]; then
  warn "configuration Apache ignoree (--no-apache)"
elif ! command -v apache2ctl >/dev/null 2>&1; then
  warn "Apache n'est pas installe : rien a configurer"
elif [ ! -f deploy/apache/uswap.conf ]; then
  warn "deploy/apache/uswap.conf absent : configuration Apache ignoree"
else
  DOMAIN="$(printf '%s' "$PUBLIC_URL" | sed 's|https\?://||;s|/.*||')"
  TARGET="/etc/apache2/sites-available/uswap.conf"

  if [ -f "$TARGET" ] && grep -q "$DOMAIN" "$TARGET" 2>/dev/null; then
    ok "VirtualHost Apache deja installe pour $DOMAIN"
  else
    if [ -f "$TARGET" ]; then
      BACKUP="$TARGET.bak-$(date +%Y%m%d-%H%M%S)"
      cp "$TARGET" "$BACKUP"
      warn "VirtualHost existant sauvegarde : $BACKUP"
    fi
    sed "s|uswap.example.org|$DOMAIN|g" deploy/apache/uswap.conf > "$TARGET"
    ok "VirtualHost ecrit : $TARGET (domaine $DOMAIN)"

    a2enmod proxy proxy_http headers ssl rewrite >/dev/null 2>&1 || true
    a2ensite uswap.conf >/dev/null 2>&1 || true

    if apache2ctl configtest >/dev/null 2>&1; then
      systemctl reload apache2
      ok "Apache recharge (configtest OK)"
    else
      warn "apache2ctl configtest a echoue : Apache N'A PAS ete recharge"
      warn "corriger $TARGET puis : sudo apache2ctl configtest && sudo systemctl reload apache2"
    fi
  fi
fi

# -----------------------------------------------------------------------------
printf '\n%s=========================================================%s\n' "$B" "$N"
printf '%s  DEPLOIEMENT TERMINE%s\n' "$G" "$N"
printf '%s=========================================================%s\n' "$B" "$N"
cat <<EOF

  Application (dans le serveur) : $BASE
  Application (publique)        : ${PUBLIC_URL:-<PUBLIC_APP_URL>}

  Connexion initiale
    e-mail       : $(get_env SUPERADMIN_EMAIL)
    mot de passe : (SUPERADMIN_PASSWORD de deploy/.env)

  Commandes utiles
    etat des services : docker compose ${T[*]} ps
    journaux backend  : docker compose ${T[*]} logs -f backend
    journaux frontend : docker compose ${T[*]} logs -f frontend
    mise a jour       : git pull --ff-only && sudo bash deploy/deploy.sh
    retour arriere    : sudo bash deploy/rollback.sh
    arreter (sans perdre les donnees) : docker compose ${T[*]} stop

  Sauvegarde de la base
    docker compose ${T[*]} exec -T db pg_dump -U uswap -d uswap -Fc > uswap-\$(date +%F).dump

EOF
