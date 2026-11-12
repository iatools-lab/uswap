#!/usr/bin/env bash
# =============================================================================
# uSwap — « le déploiement a réussi mais rien ne change » : diagnostic en une
# commande, en LECTURE SEULE (aucune modification, aucun conteneur recréé).
#
#   bash deploy/check-live.sh
#
# Conventions (le script est validé sur le serveur par `bash -n` et
# scripts/check-bash.mjs, et exécuté via `bash`, jamais via `sh`) :
#   - fonctions dédiées pour chaque mesure ; rien n'est modifié sans `--build`
#   - un seul fichier autonome : téléchargeable seul sur le serveur
#   - compatible bash 3 (macOS) comme bash 5 (Ubuntu)
#
# Il répond à une question : que sert réellement le serveur, et le code que
# vous avez modifié est-il bien celui qui tourne ?
#
#   1. conteneurs, images, dates de construction et fractions du contexte de
#      build (la panne historique : 9 Ko au lieu de 1,6 Mo) ;
#   2. bundle servi par le frontend, comparé à celui du conteneur ;
#   3. fonctionnalités attendues, cherchées dans TOUS les chunks du bundle ;
#   4. comparaison avec l'URL publique (reverse proxy / autre conteneur) ;
#   5. routes API du code courant ;
#   6. migrations Prisma.
#
# Sortie : code 0 si tout est cohérent, 1 sinon.
# =============================================================================

set -uo pipefail

# Couleurs, désactivées si la sortie n'est pas un terminal.
if [ -t 1 ]; then
  Cb=$'\033[1m'; Cg=$'\033[32m'; Cy=$'\033[33m'; Cr=$'\033[31m'; Cn=$'\033[0m'
else
  Cb=""; Cg=""; Cy=""; Cr=""; Cn=""
fi
step() { printf '\n%s==> %s%s\n' "$Cb" "$1" "$Cn"; }
ok()   { printf '  %s[OK]%s %s\n' "$Cg" "$Cn" "$1"; }
warn() { printf '  %s[ATTENTION]%s %s\n' "$Cy" "$Cn" "$1"; }
bad()  { printf '  %s[INCOHERENT]%s %s\n' "$Cr" "$Cn" "$1"; }
fail() { bad "$1"; Fail=$((Fail + 1)); }

Fail=0
DoBuild=0
for arg in "$@"; do
  case "$arg" in
    --build) DoBuild=1 ;;
    -h|--help) sed -n '1,28p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "Argument inconnu : $arg (options : --build)"; exit 2 ;;
  esac
done

Root="$(cd "$(cd "$(dirname "$0")" && pwd)/.." && pwd)"
cd "$Root" || { echo "racine du depot introuvable."; exit 2; }
Envf="deploy/.env"
Compose="deploy/compose.yaml"
[ -f "$Envf" ] || { echo "deploy/.env introuvable : lancer depuis la racine du depot."; exit 2; }
Tab_Compose=(-f "$Compose" --env-file "$Envf")

# Valeur d'une cle sans commentaire ni guillemets (sans expansion imbriquee).
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

FePort="$(read_env FRONTEND_HOST_PORT)"; FePort="${FePort:-8080}"
BePort="$(read_env BACKEND_HOST_PORT)"; BePort="${BePort:-3000}"
Base="http://127.0.0.1:$FePort"

http_code() { curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$@" 2>/dev/null || echo "000"; }
fetch() { curl -sS --max-time 15 "$@" 2>/dev/null || true; }

# =============================================================================
step "1/6  Conteneurs, images et contexte de build"
# =============================================================================
docker compose "${Tab_Compose[@]}" ps 2>/dev/null || true

container_of() { docker compose "${Tab_Compose[@]}" ps -q "$1" 2>/dev/null | head -n1; }

for svc in backend frontend; do
  cid="$(container_of "$svc")"
  if [ -z "$cid" ]; then
    fail "conteneur '$svc' absent : docker compose ${Tab_Compose[*]} up -d"
    continue
  fi
  created="$(docker inspect -f '{{.Created}}' "$cid" 2>/dev/null)"
  image="$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null)"
  imgdate="$(docker image inspect -f '{{.Created}}' "$image" 2>/dev/null || echo 'inconnue')"
  printf '  %-8s conteneur  %s\n' "$svc" "$created"
  printf '  %-8s image      %s\n' "" "$image"
  printf '  %-8s construite %s\n' "" "$imgdate"
done

# Taille du contexte de build : c'est la mesure décisive. Un contexte de
# quelques Ko signifie que les sources n'ont PAS été transférées au builder.
measure_context() { # $1 = dossier de contexte (ou chemin vide)
  local dir
  dir="$1"
  if [ -z "$dir" ]; then printf 'absent'; return; fi
  if [ ! -d "$dir" ]; then printf 'ABSENT'; return; fi
  case "$dir" in
    /*) ;;
    *) dir="$Root/$dir" ;;
  esac
  du -sk \
    --exclude=node_modules --exclude=dist --exclude=.git --exclude=coverage \
    --exclude='*.log' --exclude=backups --exclude=_scripts \
    "$dir" 2>/dev/null | awk '{print $1 "K"}'
}

FeCtx="$(read_env FRONTEND_BUILD_CONTEXT)"; FeCtx="${FeCtx:-../frontend_new/frontend}"
BeCtx="$(read_env BACKEND_BUILD_CONTEXT)"; BeCtx="${BeCtx:-../backend_new}"
# Les contextes de build sont relatifs à deploy/ ; les chemins lus affichés
# sont résolus depuis la racine pour rester lisibles.
FeCtxRel="$FeCtx"; BeCtxRel="$BeCtx"
: "$BePort"  # affiché par docker compose ps ; conservé pour la lisibilité
FeSize="$(measure_context "$FeCtx")"
BeSize="$(measure_context "$BeCtx")"
printf '  %-8s contexte %s -> %s\n' "frontend" "$FeCtx" "$FeSize"
printf '  %-8s contexte %s -> %s\n' "backend" "$BeCtx" "$BeSize"

# Source de vérité : le dossier src/ qui sera réellement copié dans l'image.
resolve_from_deploy() { # $1 = chemin relatif à deploy/
  local abs
  abs="$(cd "deploy" 2>/dev/null && cd "$1" 2>/dev/null && pwd)"
  if [ -n "$abs" ]; then printf '%s' "$abs"; else printf '%s' "$Root/$1"; fi
}
FeSrc="$(resolve_from_deploy "$FeCtxRel")/src"
# Fichiers précis attendus : un src/ présent mais vide laisse le build réussir
# avec un bundle étranger au code (panne du contexte de 9 Ko).
for f in main.tsx app/router.tsx api/auth-api.ts; do
  if [ -f "$FeSrc/$f" ]; then
    ok "  src/$f"
  else
    fail "  src/$f manquant : sources frontend incomplètes (deploy/fix-missing-sources.sh)"
  fi
done
if [ -d "$FeSrc" ]; then
  fe_kb="$(du -sk --exclude=node_modules "$FeSrc" 2>/dev/null | awk '{print $1}')"
  [ -n "$fe_kb" ] || fe_kb=0
  if [ "$fe_kb" -lt 200 ] 2>/dev/null; then
    fail "sources frontend absentes ou tronquées : $FeSrc ($fe_kb Ko).
      L'image construite ne peut pas contenir les modifications.
      Corriger : copier les sources (deploy/DEPLOYMENT_GUIDE.md) ou récupérer le commit."
  else
    ok "sources frontend présentes ($fe_kb Ko)"
  fi
else
  fail "dossier $FeSrc introuvable : l'image frontend ne peut pas être à jour."
fi

BeSrc="$(resolve_from_deploy "$BeCtxRel")/src"
if [ -d "$BeSrc" ]; then
  be_kb="$(du -sk "$BeSrc" 2>/dev/null | awk '{print $1}')"
  [ -n "$be_kb" ] || be_kb=0
  if [ "$be_kb" -lt 50 ] 2>/dev/null; then
    fail "sources backend absentes ou tronquées dans $BeSrc ($be_kb Ko)."
  else
    ok "sources backend présentes ($be_kb Ko)"
  fi
else
  fail "dossier $BeSrc introuvable : l'image backend ne peut pas être à jour."
fi

# Sources non commitées : une image locale les contient, un 'git pull' non.
if [ -d .git ]; then
  printf '  %-8s HEAD %s\n' "git" "$(git log -1 --format='%h %cd %s' --date=short 2>/dev/null | cut -c1-70)"
  if [ -n "$(git status --porcelain -- backend_new/src frontend_new/frontend/src frontend_new/frontend/public 2>/dev/null)" ]; then
    warn "des sources ne sont pas commitées ici (git status) : elles sont dans l'image
      construite sur CE serveur, mais pas dans le dépôt distant."
  fi
  if [ -z "$(git status --porcelain --untracked-files=normal -- deploy 2>/dev/null)" ]; then
    warn "deploy/ est identique au commit : si un correctif récent n'est pas
      visible ici, il n'a pas été poussé (git push) puis récupéré (git pull)."
  fi
fi

# =============================================================================
step "2/6  Bundle servi par le frontend"
# =============================================================================
Index="$(fetch "$Base/")"
Bundles=""
MainJs=""
if [ -z "$Index" ]; then
  fail "http://127.0.0.1:$FePort/ ne répond pas (conteneur arrêté ou port différent : FRONTEND_HOST_PORT)."
else
  Bundles="$(printf '%s' "$Index" | grep -oE '/assets/[A-Za-z0-9._-]+\.js' | sort -u)"
  MainJs="$(printf '%s\n' "$Bundles" | grep -E '/assets/index-' | head -n1)"
  [ -n "$MainJs" ] || MainJs="$(printf '%s\n' "$Bundles" | head -n1)"
  if [ -z "$MainJs" ]; then
    fail "la page d'accueil ne référence aucun /assets/*.js : ce n'est pas l'application uSwap."
  else
    NbBundles="$(printf '%s\n' "$Bundles" | grep -c 'assets/')"
    ok "page servie : http://127.0.0.1:$FePort$MainJs ($NbBundles chunks référencés)"
    Headers="$(curl -sSI --max-time 10 "$Base$MainJs" 2>/dev/null | tr -d '\r')"
    printf '%s\n' "$Headers" | grep -iE '^(last-modified|etag|content-length):' | sed 's/^/      /'

    cid="$(container_of frontend)"
    if [ -n "$cid" ]; then
      InImage="$(docker exec "$cid" sh -c 'ls /usr/share/nginx/html/assets/index-*.js' 2>/dev/null | head -n1)"
      ServedPath="/usr/share/nginx/html$MainJs"
      if [ -z "$InImage" ]; then
        fail "le conteneur frontend ne contient aucun index-*.js : image vide."
      else
        if [ "$InImage" = "$ServedPath" ]; then
          ok "le bundle servi est bien celui contenu dans le conteneur"
        else
          fail "le bundle servi ($MainJs) diffère de celui du conteneur
      ($(basename "$InImage")) : un autre conteneur ou un proxy répond sur ce port."
        fi
      fi
      nfiles="$(docker exec "$cid" sh -c 'ls /usr/share/nginx/html/assets/*.js | wc -l' 2>/dev/null)"
      printf '      %s chunk(s) dans le conteneur\n' "${nfiles:-?}"
    fi
  fi
fi

# =============================================================================
step "3/6  Fonctionnalités attendues dans le bundle"
# =============================================================================
# Les écrans sont chargés à la demande (React.lazy) : chaque fonctionnalité vit
# dans un chunk séparé, absent de index-*.js. On lit donc TOUS les chunks.
AllJs=""
if [ -n "${Bundles:-}" ]; then
  for b in $Bundles; do
    AllJs="$AllJs$(fetch "$Base$b")"
  done
fi

check_feature() { # $1 = libellé, $2 = motif grep -E
  if [ -z "$AllJs" ]; then return; fi
  if printf '%s' "$AllJs" | grep -qE "$2"; then
    ok "$1 : présent"
  else
    fail "$1 : ABSENT du bundle servi -> le code déployé est plus ancien."
  fi
}
check_feature "rôle super administrateur"      '/app/super-admin'
check_feature "fuseau de la station"           'Africa/Douala'
check_feature "écran de nettoyage des données" 'nettoyage'
check_feature "cartographie (Leaflet)"         'unpkg\.com/leaflet|leaflet_full|uswap-station-pin'
check_feature "indicateur de version (nouveau)" 'uswap:build'
if [ "$Fail" -eq 0 ]; then
  ok "aucune fonctionnalité manquante"
fi

# =============================================================================
step "4/6  Accès extérieur (reverse proxy)"
# =============================================================================
PublicUrl="$(read_env PUBLIC_APP_URL)"
case "$PublicUrl" in
  http*) ;;
  *) PublicUrl="$(read_env CORS_ORIGIN | sed 's|.*https\?://||;s|[,/].*||')"; [ -n "$PublicUrl" ] && PublicUrl="https://$PublicUrl" ;;
esac
if [ -z "$MainJs" ]; then
  warn "étape ignorée (aucun bundle identifié en local)."
elif [ -z "$PublicUrl" ]; then
  warn "PUBLIC_APP_URL / CORS_ORIGIN non renseignés : vérifier manuellement l'URL utilisée."
else
  OutIndex="$(fetch "$PublicUrl/")"
  OutJs="$(printf '%s' "$OutIndex" | grep -oE '/assets/index-[A-Za-z0-9._-]+\.js' | head -n1)"
  if [ -z "$OutJs" ]; then
    fail "$PublicUrl ne sert pas l'application uSwap (page différente ou proxy absent)."
  elif [ "$OutJs" = "$MainJs" ]; then
    ok "$PublicUrl sert le même bundle que le conteneur ($OutJs)"
  else
    fail "$PublicUrl sert $OutJs alors que le conteneur sert $MainJs :
      le reverse proxy (ou un second conteneur) sert une ANCIENNE version."
    printf '      Indices : docker ps ; nginx -T | grep proxy_pass ; apache2ctl -S\n'
  fi
fi

# =============================================================================
step "5/6  Routes API"
# =============================================================================
r="$(http_code "$Base/api/auth/session")"
case "$r" in
  204) ok "GET /api/auth/session -> 204 (API jointe)." ;;
  401) ok "GET /api/auth/session -> 401 (API jointe)." ;;
  200) warn "GET /api/auth/session -> 200 (un cookie de session traînait)." ;;
  000) fail "GET /api/auth/session -> aucune réponse (proxy /api ou backend arrêté)." ;;
  *)   fail "GET /api/auth/session -> $r (docker compose ${Tab_Compose[*]} logs --tail=50 backend)." ;;
esac
# Routes apparues avec les dernières livraisons : 401/403 = présente, 404 =
# code plus ancien. (Un contrôleur absent renvoie aussi 404.)
for route in /api/me /api/superadmin/cleanup /api/reports/dashboard; do
  r="$(http_code "$Base$route")"
  case "$r" in
    401|403) ok "GET $route -> $r (route présente, protection active)" ;;
    404|000) fail "GET $route -> $r : route absente, l'image backend ne correspond pas au code." ;;
    *)     ok "GET $route -> $r (route présente)" ;;
  esac
done

# =============================================================================
step "6/6  Migrations"
# =============================================================================
PgUser="$(read_env POSTGRES_USER)"; PgUser="${PgUser:-uswap}"
PgDb="$(read_env POSTGRES_DB)"; PgDb="${PgDb:-uswap}"
psql_q() {
  docker compose "${Tab_Compose[@]}" exec -T db psql -U "$PgUser" -d "$PgDb" -tAc "$1" 2>/dev/null | tr -d '[:space:]'
}
Applied="$(psql_q 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')"
Pending="$(psql_q 'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL')"
Expected="$(ls -d backend_new/prisma/migrations/*/ 2>/dev/null | wc -l)"
if [ -z "$Applied" ]; then
  warn "impossible de lire _prisma_migrations (base démarrée ? docker compose ps)."
else
  if [ "$Applied" -lt "$Expected" ] 2>/dev/null; then
    fail "$Applied migration(s) appliquée(s) sur $Expected versionnée(s) :
      docker compose ${Tab_Compose[*]} --profile tools run --rm migrate"
  else
    ok "$Applied migration(s) appliquée(s) sur $Expected versionnée(s)"
  fi
  [ -n "$Pending" ] && fail "migration en échec : $Pending (deploy/DEPLOYMENT_GUIDE.md)."
fi

# =============================================================================
# Reconstruction explicite (uniquement avec --build)
# =============================================================================
if [ "$DoBuild" -eq 1 ]; then
  step "Reconstruction (demandée par --build)"
  docker compose "${Tab_Compose[@]}" build --no-cache backend frontend || fail "build en échec"
  docker compose "${Tab_Compose[@]}" up -d --force-recreate backend frontend || fail "démarrage en échec"
  printf '\n  Relancer ensuite : bash deploy/check-live.sh\n'
fi

printf '\n%s=========================================================%s\n' "$Cb" "$Cn"
if [ "$Fail" -eq 0 ]; then
  printf '%s  AUCUNE INCOHÉRENCE : le serveur sert le code courant.%s\n' "$Cg" "$Cn"
  printf '  Si le navigateur montre encore une ancienne version, verifier le cache du\n'
  printf '  navigateur (le service worker se met à jour automatiquement depuis le\n'
  printf '  correctif). Contrôle : Compte -> Profil -> « Version déployée ».\n'
else
  printf '%s  %s incohérence(s) : voir les lignes [INCOHERENT].%s\n' "$Cr" "$Fail" "$Cn"
  printf '  Reconstruction complète : bash deploy/check-live.sh --build\n'
fi
printf '%s=========================================================%s\n' "$Cb" "$Cn"
[ "$Fail" -eq 0 ] || exit 1
exit 0
