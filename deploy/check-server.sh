#!/usr/bin/env bash
# uSwap — verification de l'arborescence AVANT tout build Docker.
#
# A executer sur le serveur, depuis le dossier qui contient deploy/ :
#   cd /opt/uswap && bash deploy/check-server.sh
#
# Le script ne modifie RIEN : il se contente de constater. Il repond a la
# question "pourquoi le build ne trouve-t-il pas frontend/Dockerfile ?".

set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

ok=0
fail=0
warn=0

pass() { printf '  [OK]   %s\n' "$1"; ok=$((ok + 1)); }
bad()  { printf '  [ERREUR] %s\n' "$1"; fail=$((fail + 1)); }
warning() { printf '  [ATTENTION] %s\n' "$1"; warn=$((warn + 1)); }

echo "Racine analysee : $ROOT"
echo

# --------------------------------------------------------------- fichiers ---
echo "1. Fichiers obligatoires"
for f in deploy/compose.yaml deploy/.env.example; do
  [ -f "$f" ] && pass "$f" || bad "$f manquant"
done

# Un .env reel est indispensable : compose refuse de demarrer sans les secrets.
if [ -f deploy/.env ]; then
  pass "deploy/.env present"
  if [ "$(stat -c '%a' deploy/.env)" = "600" ]; then
    pass "deploy/.env en permissions 600"
  else
    warning "deploy/.env n'est pas en 600 (chmod 600 deploy/.env)"
  fi
  placeholders="$(grep -nE '=.*(CHANGER-|uswap\.example\.org)' deploy/.env | cut -d: -f1 | tr '\n' ' ')"
  if [ -n "$placeholders" ]; then
    bad "deploy/.env contient encore des valeurs d'exemple (lignes $placeholders)"
  else
    pass "deploy/.env ne contient plus de valeurs d'exemple"
  fi
else
  bad "deploy/.env absent (cp deploy/.env.example deploy/.env)"
fi
echo

# ---------------------------------------------------------------- sources ---
# Compose lit deploy/.env : c'est cette valeur qui prevaut au build.
# L'environnement du shell ne sert de repli que si la variable n'y figure pas.
env_get() { # $1 = nom de variable
  sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" deploy/.env 2>/dev/null \
    | head -n1 | tr -d '\r' | sed -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

echo "2. Contexte de construction du FRONTEND"
frontend_ctx="${FRONTEND_BUILD_CONTEXT:-$(env_get FRONTEND_BUILD_CONTEXT)}"
frontend_ctx="${frontend_ctx:-../frontend}"
frontend_dir="$(cd deploy 2>/dev/null && cd "$frontend_ctx" 2>/dev/null && pwd)"
if [ -z "${frontend_dir:-}" ]; then
  bad "contexte introuvable : $frontend_ctx (relatif a deploy/)"
  warning "Indiquer le bon chemin dans deploy/.env : FRONTEND_BUILD_CONTEXT=..."
else
  pass "contexte resolu : $frontend_dir"
  for f in package.json package-lock.json Dockerfile index.html vite.config.ts tsconfig.json; do
    [ -f "$frontend_dir/$f" ] && pass "  $f" || bad "  $f manquant dans $frontend_dir"
  done
  for d in src public deploy; do
    [ -d "$frontend_dir/$d" ] && pass "  $d/" || bad "  $d/ manquant dans $frontend_dir"
  done
  [ -f "$frontend_dir/deploy/nginx.conf" ] \
    && pass "  deploy/nginx.conf" \
    || bad "  deploy/nginx.conf manquant (copie par le Dockerfile)"
  [ -f "$frontend_dir/.env" ] \
    && warning "  $frontend_dir/.env present : exclu par .dockerignore, mais ne doit pas fuiter"
fi
echo

echo "3. Contexte de construction du BACKEND"
backend_ctx="${BACKEND_BUILD_CONTEXT:-$(env_get BACKEND_BUILD_CONTEXT)}"
backend_ctx="${backend_ctx:-../backend_new}"
backend_dir="$(cd deploy 2>/dev/null && cd "$backend_ctx" 2>/dev/null && pwd)"
if [ -z "${backend_dir:-}" ]; then
  bad "contexte introuvable : $backend_ctx (relatif a deploy/)"
  warning "Indiquer le bon chemin dans deploy/.env : BACKEND_BUILD_CONTEXT=..."
else
  pass "contexte resolu : $backend_dir"
  for f in package.json package-lock.json Dockerfile tsconfig.json tsconfig.build.json; do
    [ -f "$backend_dir/$f" ] && pass "  $f" || bad "  $f manquant dans $backend_dir"
  done
  [ -d "$backend_dir/src" ] && pass "  src/" || bad "  src/ manquant"
  [ -f "$backend_dir/prisma/schema.prisma" ] \
    && pass "  prisma/schema.prisma" \
    || bad "  prisma/schema.prisma manquant"
  if [ -d "$backend_dir/prisma/migrations" ]; then
    count=$(find "$backend_dir/prisma/migrations" -mindepth 1 -maxdepth 1 -type d | wc -l)
    [ "$count" -gt 0 ] && pass "  prisma/migrations ($count migration(s))" \
      || bad "  prisma/migrations vide"
  else
    bad "  prisma/migrations manquant (prisma migrate deploy ne creera pas le schema)"
  fi
  grep -q 'provider = "postgresql"' "$backend_dir/prisma/schema.prisma" 2>/dev/null \
    && pass "  datasource PostgreSQL" \
    || bad "  prisma/schema.prisma n'est pas en PostgreSQL"
fi
echo

# ------------------------------------------------------------------ ports ---
echo "4. Ports deja utilises (Docker publie 127.0.0.1)"
echo
get_port() { sed -n "s/^[[:space:]]*$1:[[:space:]]*//p" deploy/.env 2>/dev/null | head -n1 | tr -d '\r'; }
front_port="$(get_port FRONTEND_HOST_PORT)"; front_port="${front_port:-8080}"
back_port="$(get_port BACKEND_HOST_PORT)"; back_port="${back_port:-3000}"
for pair in "frontend:$front_port" "backend:$back_port"; do
  name="${pair%%:*}"; port="${pair##*:}"
  in_use="$(ss -ltnH "sport = :$port" 2>/dev/null | wc -l)"
  if [ "${in_use:-0}" -gt 0 ]; then
    bad "port $port ($name) deja occupe : $(ss -ltnpH "sport = :$port" 2>/dev/null | head -n1 | tr -s ' ')"
    warning "choisir un autre port dans deploy/.env ($(echo "$name" | tr '[:lower:]' '[:upper:]')_HOST_PORT)"
  else
    pass "port $port ($name) libre"
  fi
done
echo

# ----------------------------------------------------------------- resume ---
echo "Resume : $ok OK, $warn attention, $fail erreur(s)."
if [ "$fail" -gt 0 ]; then
  echo "Corriger les erreurs ci-dessus avant : docker compose -f deploy/compose.yaml --env-file deploy/.env build"
  exit 1
fi
echo "Arborescence prete. Etape suivante :"
echo "  docker compose -f deploy/compose.yaml --env-file deploy/.env config >/dev/null"
echo "  docker compose -f deploy/compose.yaml --env-file deploy/.env build"
exit 0
