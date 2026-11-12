#!/usr/bin/env bash
# =============================================================================
# uSwap — réparer un dossier /opt/uswap incomplet (sources du frontend absentes).
#
#   bash deploy/fix-missing-sources.sh            # constat (lecture seule)
#   bash deploy/fix-missing-sources.sh --apply    # met les sources en place
#
# Contexte (constat du 2026-10-29 sur Sirh-Server) :
#   /opt/uswap/frontend ne contient pas les sources de
#   l'application. `docker compose build frontend` réussit pourtant : le build
#   réutilise le cache BuildKit (`npm ci`, `npm run build` « CACHED ») et
#   fabrique une image avec un bundle qui n'a rien à voir avec le code.
#   C'est l'origine de « le déploiement a réussi mais rien ne change ».
#
# Ce script :
#   1. vérifie la présence des fichiers sources attendus ;
#   2. cherche ailleurs sur le disque une copie complète du frontend ;
#   3. avec --apply : copie les sources dans l'arborescence lue par Compose,
#      puis rappelle les commandes de reconstruction.
# Il ne supprime rien et ne touche ni deploy/.env, ni node_modules, ni dist.
# =============================================================================

set -uo pipefail

Apply=0
for arg in "$@"; do
  case "$arg" in
    --apply) Apply=1 ;;
    -h|--help) sed -n '2,22p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Argument inconnu : $arg"; exit 2 ;;
  esac
done

Root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$Root" || exit 2
Envf="deploy/.env"
[ -f "$Envf" ] || { echo "deploy/.env introuvable"; exit 2; }

read_env() {
  local line value
  line="$(grep -E "^[[:space:]]*$1[[:space:]]*=" "$Envf" 2>/dev/null | tail -n1)"
  value="${line#*=}"
  value="$(printf '%s' "$value" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
  case "$value" in
    \"*\") value="${value#\"}"; value="${value%\"}" ;;
    \'*\') value="${value#\'}"; value="${value%\'}" ;;
  esac
  printf '%s' "$value"
}

FeCtx="$(read_env FRONTEND_BUILD_CONTEXT)"; FeCtx="${FeCtx:-../frontend}"
BeCtx="$(read_env BACKEND_BUILD_CONTEXT)"; BeCtx="${BeCtx:-../backend}"
FeDir="$(cd "deploy" 2>/dev/null && cd "$FeCtx" 2>/dev/null && pwd)"
BeDir="$(cd "deploy" 2>/dev/null && cd "$BeCtx" 2>/dev/null && pwd)"
[ -n "$FeDir" ] || FeDir="$Root/$FeCtx"
[ -n "$BeDir" ] || BeDir="$Root/$BeCtx"

echo "== Chemins lus par deploy/compose.yaml"
echo "   frontend : $FeDir"
echo "   backend  : $BeDir"

# --- 1. Fichiers indispensables ---------------------------------------------
Missing=0
check() { # $1 = dossier, $2.. = fichiers relatifs attendus
  local dir f
  dir="$1"; shift
  for f in "$@"; do
    if [ -e "$dir/$f" ]; then
      printf '   [OK]          %-46s\n' "$f"
    else
      printf '   [MANQUANT]    %-46s\n' "$f"
      Missing=$((Missing + 1))
    fi
  done
}

echo
echo "== Frontend (sources)"
check "$FeDir" package.json package-lock.json index.html vite.config.ts tsconfig.json Dockerfile deploy/nginx.conf
for f in src/main.tsx src/app/router.tsx src/api/auth-api.ts; do
  if [ -e "$FeDir/$f" ]; then
    printf '   [OK]          %-46s\n' "$f"
  else
    printf '   [MANQUANT]    %-46s\n' "$f"
    Missing=$((Missing + 1))
  fi
done

echo
echo "== Backend (sources)"
check "$BeDir" package.json package-lock.json tsconfig.json Dockerfile prisma/schema.prisma src/main.ts

# --- 2. Autres copies complètes sur le disque -------------------------------
echo
echo "== Recherche d'une copie complète du frontend"
Candidate=""
# Un dossier valide contient src/app/router.tsx ET vite.config.ts.
while IFS= read -r f; do
  d="$(dirname "$f")"
  [ -f "$d/vite.config.ts" ] || continue
  [ "$d" = "$FeDir" ] && continue
  echo "   candidat : $d"
  if [ -z "$Candidate" ]; then Candidate="$d"; fi
done < <(find /opt /srv /home /root /var/www /tmp -maxdepth 6 \
           -path '*/node_modules' -prune -o -path '*/src/app/router.tsx' -print 2>/dev/null | head -n 20)

if [ "$Missing" -eq 0 ]; then
  echo
  echo "Les sources sont complètes : rien à réparer."
  echo "Si les modifications n'apparaissent toujours pas, lancer : bash deploy/check-live.sh"
  exit 0
fi

if [ -z "$Candidate" ]; then
  cat <<'EOF'

Aucune autre copie complète n'a été trouvée sur ce serveur.
Le frontend doit être fourni depuis le poste de développement :

  # sur le poste Windows (dossier frontend SANS node_modules ni dist)
  scp -r "frontend" root@Sirh-Server:/tmp/uswap-frontend

  # sur le serveur
  cp -a /tmp/uswap-frontend/. "<dossier affiché en tête>"/ 

Puis :
  docker compose -f deploy/compose.yaml --env-file deploy/.env build --no-cache frontend
  docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --force-recreate frontend
EOF
  exit 1
fi

echo
echo "   copie utilisée : $Candidate"
if [ "$Apply" -eq 0 ]; then
  cat <<EOF

Mode constat (aucune modification). Pour copier les sources :
  bash deploy/fix-missing-sources.sh --apply
Copie prévue : $Candidate -> $FeDir
EOF
  exit 1
fi

# --- 3. Mise en place --------------------------------------------------------
echo
echo "== Copie des sources (sans node_modules, dist, .git, .env)"
cp -a "$Candidate"/. "$FeDir"/
rm -rf "$FeDir/node_modules" "$FeDir/dist" 2>/dev/null || true
FeMissing=0
for f in package.json package-lock.json index.html vite.config.ts src/app/router.tsx Dockerfile deploy/nginx.conf; do
  [ -e "$FeDir/$f" ] || { echo "   [TOUJOURS MANQUANT] $f"; FeMissing=$((FeMissing + 1)); }
done
if [ "$FeMissing" -gt 0 ]; then
  echo "Copie incomplète : vérifier le dossier source."
  exit 1
fi
echo "   sources en place ($(du -sk --exclude=node_modules "$FeDir/src" | awk '{print $1}') Ko dans src/)"

cat <<'EOF'

Étapes suivantes (obligatoires : le cache BuildKit doit être ignoré) :

  docker compose -f deploy/compose.yaml --env-file deploy/.env build --no-cache frontend
  docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --force-recreate frontend
  bash deploy/check-live.sh

Dans la sortie du build, la ligne « transferring context » doit indiquer
PLUSIEURS MÉGAOCTETS (1,6 Mo de sources). Quelques Ko = sources toujours absentes.
EOF
