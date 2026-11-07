#!/usr/bin/env bash
# =============================================================================
# uSwap — guide de deploiement complet, executable et lisible.
#
#   bash deploy/deploy.sh              # deploiement complet
#   bash deploy/deploy.sh --check      # controle seul, ne modifie rien
#   bash deploy/deploy.sh --help       # affiche ce document
#
# Le script est IDEMPOTENT : on peut le relancer, il ne casse rien.
# Il ne supprime JAMAIS de volume Docker, de base ni de donnee.
#
# -----------------------------------------------------------------------------
# 1. ARCHITECTURE
# -----------------------------------------------------------------------------
#
#   Internet
#     │  HTTPS (443)
#     ▼
#   Nginx de l'hote  ──►  127.0.0.1:8080  ──►  conteneur frontend (Nginx :80)
#     (certbot)                                  ├── /            → index.html (SPA React)
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
#     deploy/audit-uswap.md        audit complet du depot (a lire en premier)
#
# -----------------------------------------------------------------------------
# 2. LES 10 COMMANDES (a executer sur le serveur Ubuntu, en root)
# -----------------------------------------------------------------------------
#
#   # 1  Recuperer le code
#   git clone <url-du-depot> /opt/uswap-github && cd /opt/uswap-github
#
#   # 2  Se placer sur la branche livree
#   git switch develop && git pull --ff-only
#
#   # 3  Creer la configuration (permissions 600)
#   cp deploy/.env.example deploy/.env && chmod 600 deploy/.env
#
#   # 4  Renseigner les valeurs de la section 4 ci-dessous
#   nano deploy/.env
#
#   # 5  Verifier la configuration (ne modifie rien)
#   bash deploy/deploy.sh --check
#
#   # 6  Construire les images
#   docker compose -f deploy/compose.yaml --env-file deploy/.env build
#
#   # 7  Demarrer PostgreSQL
#   docker compose -f deploy/compose.yaml --env-file deploy/.env up -d db
#
#   # 8  Appliquer le schema Prisma
#   docker compose -f deploy/compose.yaml --env-file deploy/.env --profile tools run --rm migrate
#
#   # 9  Creer le referentiel et le super administrateur
#   docker compose -f deploy/compose.yaml --env-file deploy/.env --profile tools run --rm bootstrap
#
#   # 10 Demarrer l'application et verifier
#   docker compose -f deploy/compose.yaml --env-file deploy/.env up -d && bash deploy/deploy.sh --check
#
#   Les commandes 6 a 10 sont exactement ce que fait `bash deploy/deploy.sh`
#   sans argument : le script est la version automatisee de cette liste.
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
#   Un identifiant Google mis dans backend_new/.env ou dans
#   frontend_new/frontend/.env marche sur le poste de developpement mais PAS
#   en production. En production, tout se regle dans deploy/.env.
#
#   ATTENTION : les valeurs deja presentes dans deploy/.env.example sont des
#   MODELES. C'est deploy/.env (cree a l'etape 3) qui est lu par Docker.
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
#       Le garder prive dans la console Google Cloud.
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
#   - Nginx de l'hote : proxy_pass http://127.0.0.1:8080 (voir README_DOCKER.md §7)
#   - Verifier https://<domaine>/            → ecran de connexion
#   - Verifier https://<domaine>/api/auth/session → 401 JSON
#   - Se connecter avec SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD
#   - Creer les stations : adresse, coordonnees GPS ou « Utiliser ma position »
#   - Sauvegardes : pg_dump + volume uswap-uploads (README_DOCKER.md §9)
#
#   INTERDITS en production :
#     prisma migrate dev | migrate reset | db push | docker compose down -v
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
case "${1:-}" in
  --help|-h) sed -n '2,190p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
  --check)   MODE="check" ;;
  "")        ;;
  *)         die "option inconnue : $1 (utiliser --help, --check ou rien)" ;;
esac

# -----------------------------------------------------------------------------
step "1/8  Verification de Docker"
# -----------------------------------------------------------------------------
command -v docker >/dev/null 2>&1 || die "Docker n'est pas installe (https://docs.docker.com/engine/install/ubuntu/)."
docker info >/dev/null 2>&1 || die "Le demon Docker ne repond pas. Essayer : sudo systemctl start docker"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 absent (plugin 'docker compose')."
ok "Docker $(docker --version | sed 's/Docker version //;s/,.*//') — $(docker compose version --short)"

[ -f "$COMPOSE" ] || die "deploy/compose.yaml introuvable. Lancer ce script depuis la racine du depot."

# -----------------------------------------------------------------------------
step "2/8  Sources"
# -----------------------------------------------------------------------------
if [ -d .git ]; then
  ok "depot Git : $(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo 'inconnu') — $(git log --oneline -1 2>/dev/null)"
else
  warn "ce dossier n'est pas un depot Git — sources utilisees telles quelles."
fi

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
ok "$MIG_COUNT migration(s) Prisma trouvee(s)"

# -----------------------------------------------------------------------------
step "3/8  Configuration (deploy/.env)"
# -----------------------------------------------------------------------------
if [ ! -f "$ENV_FILE" ]; then
  if [ "$MODE" = "check" ]; then
    die "deploy/.env absent. Creer avec : cp deploy/.env.example deploy/.env && chmod 600 deploy/.env"
  fi
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
  # Le depot a frontend_new/frontend, pas frontend/.
  set_env FRONTEND_BUILD_CONTEXT "..\/frontend_new\/frontend"
  set_env BACKEND_BUILD_CONTEXT "..\/backend_new"

  ok "deploy/.env cree (secrets aleatoires, permissions 600)"
  warn "renseigner maintenant la section 4 du guide : PUBLIC_APP_URL, CORS_ORIGIN,"
  warn "GOOGLE_CLIENT_ID, ADMIN_BOOTSTRAP_PASSWORD, SMTP_USER / SMTP_PASS"
else
  ok "deploy/.env existe — conserve tel quel (aucun secret ecrase)"
fi

PERMS="$(stat -c '%a' "$ENV_FILE" 2>/dev/null || echo '?')"
[ "$PERMS" = "600" ] && ok "permissions $PERMS" || warn "permissions $PERMS (attendu 600) : chmod 600 $ENV_FILE"

get_env() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | head -n1 | tr -d '\r"' ; }

# Valeurs encore a l'etat de modele : le deploiement ne doit pas partir avec.
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

if [ "$MODE" = "check" ]; then
  step "4/8  Validation de la configuration Compose"
  docker compose "${T[@]}" config >/dev/null 2>&1 \
    && ok "configuration Compose valide" \
    || die "configuration invalide. Diagnostiquer avec : docker compose -f $COMPOSE --env-file $ENV_FILE config"
  printf '\n%s  CONTROLE TERMINE — aucun changement applique.%s\n' "$G" "$N"
  exit 0
fi

# -----------------------------------------------------------------------------
step "4/8  Validation de la configuration Compose"
# -----------------------------------------------------------------------------
docker compose "${T[@]}" config >/dev/null 2>&1 \
  && ok "configuration Compose valide" \
  || die "configuration invalide. Diagnostiquer avec : docker compose -f $COMPOSE --env-file $ENV_FILE config"

# -----------------------------------------------------------------------------
step "5/8  Construction des images (quelques minutes)"
# -----------------------------------------------------------------------------
docker compose "${T[@]}" build backend
docker compose "${T[@]}" build frontend
ok "images construites"

# -----------------------------------------------------------------------------
step "6/8  Base de donnees et migrations"
# -----------------------------------------------------------------------------
docker compose "${T[@]}" up -d db
printf '  attente de PostgreSQL '
for _ in $(seq 1 40); do
  status="$(docker inspect -f '{{.State.Health.Status}}' uswap-db-1 2>/dev/null || echo starting)"
  [ "$status" = "healthy" ] && break
  printf '.'
  sleep 3
done
printf '\n'
[ "$status" = "healthy" ] || die "PostgreSQL n'est pas healthy (docker logs uswap-db-1)"
ok "PostgreSQL healthy"

# `migrate deploy` est strictement additif : il applique les migrations
# manquantes deja versionnees, sans jamais reinitialiser la base.
docker compose "${T[@]}" --profile tools run --rm migrate
ok "schema applique"

# -----------------------------------------------------------------------------
step "7/8  Referentiel et super administrateur"
# -----------------------------------------------------------------------------
# Idempotent : ne supprime rien et ne reecrit pas un mot de passe existant.
docker compose "${T[@]}" --profile tools run --rm bootstrap
ok "referentiel initialise"

# -----------------------------------------------------------------------------
step "8/8  Demarrage et verification"
# -----------------------------------------------------------------------------
docker compose "${T[@]}" up -d
printf '  attente des healthchecks '
for _ in $(seq 1 40); do
  BE="$(docker inspect -f '{{.State.Health.Status}}' uswap-backend-1 2>/dev/null || echo starting)"
  FE="$(docker inspect -f '{{.State.Health.Status}}' uswap-frontend-1 2>/dev/null || echo starting)"
  [ "$BE" = "healthy" ] && [ "$FE" = "healthy" ] && break
  printf '.'
  sleep 3
done
printf '\n'

docker compose "${T[@]}" ps

FE_PORT="$(get_env FRONTEND_HOST_PORT)"; FE_PORT="${FE_PORT:-8080}"
BASE="http://127.0.0.1:$FE_PORT"
code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$1" 2>/dev/null || echo "000"; }

printf '\n  %-40s %s\n' "page d'accueil (200 attendu)"        "$(code "$BASE/")"
printf '  %-40s %s\n' "session anonyme (401 attendu)"         "$(code "$BASE/api/auth/session")"
printf '  %-40s %s\n' "route SPA /app/admin (200 attendu)"    "$(code "$BASE/app/admin")"

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
    mise a jour       : git pull --ff-only && bash deploy/deploy.sh
    arreter (sans perdre les donnees) : docker compose ${T[*]} stop

  Sauvegarde de la base
    docker compose ${T[*]} exec -T db pg_dump -U uswap -d uswap -Fc > uswap-\$(date +%F).dump

EOF
