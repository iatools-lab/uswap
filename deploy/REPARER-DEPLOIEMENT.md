# Réparer le déploiement uSwap — guide d'intervention

**Serveur** : `root@Sirh-Server` — **dépôt** : `/opt/uswap`
**Durée** : ~30 min — **Risque** : aucun (aucune suppression, sauvegarde en étape 0)

**Le problème en une phrase** : le build frontend s'exécute sans les sources
(`transferring context: 8.98kB`, étapes `CACHED`), l'image produite ne contient
donc pas le code modifié — et le navigateur, lui, garde en plus l'ancien bundle.

**Le résultat attendu à la fin :**

```
==> 6/6  Migrations
  [OK] 3 migration(s) appliquée(s) sur 3 versionnée(s)

=========================================================
  AUCUNE INCOHÉRENCE : le serveur sert le code courant.
=========================================================
```

**Trois règles :** une étape à la fois · vérifier le résultat annoncé avant de
continuer · ne jamais coller un `cat > ... <<EOF` partiellement.

---

## Étape 0 — Sauvegarde (30 s)

```bash
cd /opt/uswap
mkdir -p /srv/backups
docker compose -f deploy/compose.yaml --env-file deploy/.env exec -T db \
  pg_dump -U uswap -d uswap -Fc > /srv/backups/uswap-$(date +%F-%H%M).dump
ls -lh /srv/backups | tail -1
```

**Résultat attendu :** une ligne `uswap-AAAAMMJJ-HHMM.dump` avec une taille > 0.
Si erreur (`no such service db`), noter et continuer : rien ne sera supprimé.

---

## Étape 1 — Constat en 30 secondes

```bash
cd /opt/uswap

echo "--- sources frontend ---"
ls -la frontend_new/frontend/src 2>/dev/null | head
du -sh frontend_new/frontend/src 2>/dev/null
find frontend_new/frontend/src -name '*.ts*' 2>/dev/null | wc -l

echo "--- sources backend ---"
du -sh backend_new/src 2>/dev/null
ls backend_new/prisma/migrations 2>/dev/null

echo "--- version du code ---"
git log -1 --oneline 2>/dev/null || echo "pas un dépôt Git"
```

**Résultats possibles :**

| Ce que vous voyez | Diagnostic | Suite |
| --- | --- | --- |
| `1.6M frontend_new/frontend/src` et `~140` fichiers | sources complètes | Étape 3 |
| `src: No such file`, vide, ou `< 200K` | **cause du problème** | Étape 2 |
| `du: cannot access 'backend_new/src'` | backend incomplet aussi | Étape 2 |
| commit `1142797` (ou ancien) | correctifs absents du serveur | Étape 2 |

---

## Étape 2 — Remettre les sources et les scripts en place

### 2.1 Nouveau dossier de travail propre (ne supprime rien)

```bash
cd /opt
STAMP=$(date +%Y%m%d-%H%M)
cp -a uswap "uswap.backup-$STAMP"
echo "sauvegarde : /opt/uswap.backup-$STAMP"
```

**Résultat attendu :** `sauvegarde : /opt/uswap.backup-20261029-1430` (sans erreur).
Retour arrière à tout moment : `mv /opt/uswap /opt/uswap.broken-$STAMP && mv /opt/uswap.backup-$STAMP /opt/uswap`.

### 2.2 Cas A — Git fonctionne et le dépôt distant contient le commit

```bash
cd /opt/uswap
git fetch --tags origin
git stash list                       # informations seulement
git status --porcelain               # si des fichiers apparaissent : git stash
git pull --ff-only origin develop
git log -1 --oneline
```

**Résultat attendu :** `git log -1` affiche un commit **différent de 1142797**.
Puis passer à l'**étape 3**.

Si `git pull` échoue (`fatal: not a git repository`, conflit, hors réseau) : cas B.

### 2.3 Cas B — Coller les scripts (pas de Git)

Copier **bloc par bloc** (le délimiteur final inclus). Chaque bloc s'arrête à
`FIN_*` ; un collage partiel provoque `syntax error near unexpected token`.

```bash
cd /opt/uswap
mkdir -p deploy scripts

cat > deploy/check-live.sh <<'FIN_CHECK_LIVE'
<<<<CHECK_LIVE>>>>
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
      Corriger : copier les sources (README_DOCKER.md §5.1) ou récupérer le commit."
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
for route in /api/me /api/super-admin/cleanup /api/reports/dashboard; do
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
  [ -n "$Pending" ] && fail "migration en échec : $Pending (README_DOCKER.md, §12)."
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
  printf '  Si le navigateur montre encore une ancienne version, c'est le cache du\n'
  printf '  navigateur (le service worker se met à jour automatiquement depuis le\n'
  printf '  correctif). Contrôle : Compte -> Profil -> « Version déployée ».\n'
else
  printf '%s  %s incohérence(s) : voir les lignes [INCOHERENT].%s\n' "$Cr" "$Fail" "$Cn"
  printf '  Reconstruction complète : bash deploy/check-live.sh --build\n'
fi
printf '%s=========================================================%s\n' "$Cb" "$Cn"
[ "$Fail" -eq 0 ] || exit 1
exit 0
<<<</CHECK_LIVE>>>>

cat > deploy/fix-missing-sources.sh <<'FIN_FIX_SOURCES'
<<<<FIX_SOURCES>>>>
#!/usr/bin/env bash
# =============================================================================
# uSwap — réparer un dossier /opt/uswap incomplet (sources du frontend absentes).
#
#   bash deploy/fix-missing-sources.sh            # constat (lecture seule)
#   bash deploy/fix-missing-sources.sh --apply    # met les sources en place
#
# Contexte (constat du 2026-10-29 sur Sirh-Server) :
#   /opt/uswap/frontend_new/frontend ne contient pas les sources de
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

FeCtx="$(read_env FRONTEND_BUILD_CONTEXT)"; FeCtx="${FeCtx:-../frontend_new/frontend}"
BeCtx="$(read_env BACKEND_BUILD_CONTEXT)"; BeCtx="${BeCtx:-../backend_new}"
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

  # sur le poste Windows (dossier frontend_new/frontend SANS node_modules ni dist)
  scp -r "frontend_new/frontend" root@Sirh-Server:/tmp/uswap-frontend

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
<<<</FIX_SOURCES>>>>

cat > scripts/check-bash.mjs <<'FIN_CHECK_BASH'
<<<<CHECK_BASH>>>>
/**
 * Contrôle syntaxique des scripts bash du dépôt, sans bash installé.
 *
 * Windows n'a pas bash (Git Bash n'est pas toujours disponible) : les scripts
 * de déploiement sont relus ici avant d'être envoyés sur le serveur. Le
 * contrôle porte sur les erreurs qui ont réellement cassé des scripts de ce
 * dépôt :
 *   - affectation avec espaces : `compose = "$x"` (invalide en bash) ;
 *   - fonction écrite en `nom() = ...` au lieu de `nom() { ... }` ;
 *   - `if`/`fi`, `case`/`esac`, `do`/`done` déséquilibrés ;
 *   - guillemets en nombre impair sur une ligne de code (une quote ouverte
 *     avale la suite du script : c'est la panne du `check-live.sh` bricolé).
 *
 * Limites assumées : ce n'est pas un analyseur shell. Il neutralise d'abord
 * tout ce qui n'est pas du code (commentaires, contenu des chaînes, heredocs,
 * et hors des blocs ```bash pour un fichier .md), puis vérifie l'équilibre
 * des structures. `bash -n` reste la référence sur le serveur.
 *
 * Usage :
 *   node scripts/check-bash.mjs [fichiers…] [--md]
 *   --md : inclut aussi les .md et n'analyse que leurs blocs ```bash
 *
 * Sortie : code 1 si une anomalie est détectée.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

const ROOT = process.cwd();
const ARGS = process.argv.slice(2);
const INCLUDE_MD = ARGS.includes('--md');
const EXPLICIT = ARGS.filter((a) => !a.startsWith('--'));



function collect(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) collect(full, acc);
    else if (name.endsWith('.sh') || (INCLUDE_MD && name.endsWith('.md')))
      acc.push(full);
  }
  return acc;
}

const blank = (s) => s.replace(/[^\n]/g, ' ');

/**
 * Neutralise le texte : tout caractère qui n'est pas du code devient espace.
 * Les sauts de ligne sont conservés pour garder la numérotation.
 *
 * Renvoie `{ code, warnings }`. `warnings` liste les lignes dont les
 * guillemets ne s'équilibrent pas sur la ligne (sans faire échouer le
 * contrôle : `l'image` hors chaîne est légitime et très fréquent ici).
 */
function neutralize(source, isMarkdown) {
  const lines = source.split('\n');
  const out = [];
  const warnings = [];
  let quote = null;
  let heredoc = null;

  lines.forEach((line, index) => {
    const n = index + 1;
    let result = '';

    if (heredoc) {
      if (line.trim() === heredoc) heredoc = null;
      out.push(blank(line));
      return;
    }

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];

      // `${x:-mot}` : les quotes internes font partie du vocabulaire shell.
      if (quote === null && line.startsWith('${', i)) {
        const close = line.indexOf('}', i);
        if (close > i) {
          result += line.slice(i, close + 1);
          i = close;
          continue;
        }
      }

      if (quote === null) {
        // Un `#` de couleur (`'\033[1m'`, `un badge #1`) ou collé à un mot
        // n'ouvre pas de commentaire en bash : seul `#` isolé ou suivi d'une
        // espace en ouvre un.
        if (
          ch === '#' &&
          (i === 0 || /\s/.test(line[i - 1])) &&
          (i === line.length - 1 || /\s/.test(line[i + 1]))
        ) {
          result += blank(line.slice(i));
          break;
        }
        const heredocStart = line.slice(i).match(/^<<-?\s*'?([A-Z_][A-Z0-9_]*)'?/);
        if (heredocStart) {
          heredoc = heredocStart[1];
          result += blank(line.slice(i));
          break;
        }
        // Apostrophe française hors chaîne : `l'image`, `s'il`, `n'est`.
        const inWord = i > 0 && /[A-Za-zÀ-ÿ0-9]/.test(line[i - 1]);
        if (ch === "'" && inWord) {
          result += ch;
          continue;
        }
        if (ch === "'" || ch === '"') {
          quote = ch;
          result += ch;
          continue;
        }
        result += ch;
      } else if (ch === '\\' && quote === '"') {
        result += '  ';
        i += 1;
      } else if (ch === quote) {
        quote = null;
        result += ch;
      } else {
        result += ' ';
      }
    }

    // Un guillemet ouvert qu'un message français a interrompu (`"... l'image"`)
    // ne peut pas s'étendre sur les lignes suivantes : on referme en fin de
    // ligne pour que la suite du script reste analysable, et on le signale.
    if (quote !== null) {
      warnings.push(n);
      quote = null;
    }
    out.push(result);
  });

  let code = out.join('\n');

  if (isMarkdown) {
    // Seul le contenu des blocs ```bash est du code. Un bloc contenant un
    // heredoc (cat > f <<'EOF' suivi du script à créer) est du CODE BASH qu'on
    // ne peut pas analyser ici : il est neutralisé pour ne pas fausser les
    // compteurs du script hôte.
    const blocks = [];
    let current = null;
    lines.forEach((line) => {
      if (/^\s*```/.test(line)) {
        if (current === null) current = [];
        else {
          blocks.push(current);
          current = null;
        }
        return;
      }
      if (current !== null) current.push(line);
    });
    const inFence = new Array(lines.length).fill(false);
    let cursor = 0;
    for (const block of blocks) {
      const body = lines.slice(cursor, cursor + block.length);
      const hasHeredoc = body.some((l) => /<<-?\s*'?[A-Z_]/.test(l));
      lines.forEach((line, i) => {
        if (i >= cursor && i < cursor + block.length) inFence[i] = !hasHeredoc;
      });
      cursor += block.length;
    }
    code = code
      .split('\n')
      .map((l, i) => (inFence[i] ? l : blank(l)))
      .join('\n');
  }

  return { code, warnings };
}

let problems = 0;
let checked = 0;

for (const file of files()) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file) || file;
  const isMd = basename(file).endsWith('.md');

  if (isMd && !/```bash/.test(text)) {
    console.log(`${rel}: ignoré (Markdown sans bloc de code bash)`);
    continue;
  }
  checked += 1;

  const report = (line, message) => {
    console.log(`${rel}:${line}: ${message}`);
    problems += 1;
  };

  const { code, warnings } = neutralize(text, isMd);
  const codeLines = code.split('\n');
  const sourceLines = text.split('\n');
  const counters = { if: 0, case: 0, do: 0, brace: 0 };

  codeLines.forEach((visible, index) => {
    const n = index + 1;
    if (!visible.trim()) return;

    if (/^\s*[A-Za-z_][A-Za-z0-9_]*\s+=\s*/.test(visible)) {
      report(n, "affectation avec espaces autour du '=' (`VAR=x`, pas `VAR = x`)");
    }
    if (/[A-Za-z0-9_]+\(\)\s*=\s*/.test(visible)) {
      report(n, '`nom() = ...` : syntaxe invalide, attendu `nom() {`');
    }

    for (const w of visible.split(/\s+/).filter(Boolean)) {
      if (w === 'if') counters.if += 1;
      if (w === 'fi') counters.if -= 1;
      if (w === 'case') counters.case += 1;
      if (w === 'esac') counters.case -= 1;
      if (w === 'do') counters.do += 1;
      if (w === 'done') counters.do -= 1;
    }
    // Accolades de bloc : uniquement celles isolées en fin de ligne
    // (fonctions `f() {` et fermetures `}`) ; ${...} et $(...) sont ignorés.
    if (/\{\s*$/.test(visible)) counters.brace += 1;
    if (/^\s*\}\s*(;|$)/.test(visible)) counters.brace -= 1;
  });

  // `do` dans `for … do` / `while … do` est compté une fois : la mesure est
  // celle des mots-clés, pas des blocs. On compare donc `do` aux `done`.
  if (counters.if !== 0)
    report(sourceLines.length, `if/fi déséquilibrés (${counters.if})`);
  if (counters.case !== 0)
    report(sourceLines.length, `case/esac déséquilibrés (${counters.case})`);
  if (counters.do !== 0)
    report(sourceLines.length, `do/done déséquilibrés (${counters.do})`);
  if (counters.brace !== 0)
    report(
      sourceLines.length,
      `accolades de bloc déséquilibrées (${counters.brace})`,
    );

  // L'avertissement par ligne est indicatif : `l'image` dans un message est
  // légitime et TRÈS fréquent dans ce dépôt (35 occurrences). On ne le
  // détaille donc pas par défaut ; `--verbose` les liste pour inspection.
  if (warnings.length && ARGS.includes('--verbose')) {
    for (const n of warnings) {
      console.log(`${rel}:${n}: quotes non équilibrées sur la ligne (informatif)`);
    }
  }
}

function files() {
  return EXPLICIT.length ? EXPLICIT : collect(ROOT);
}

if (problems === 0) {
  console.log(`check-bash : ${checked} script(s) relu(s), aucune anomalie.`);
  process.exit(0);
}
console.log(`\ncheck-bash : ${problems} anomalie(s) à corriger.`);
process.exit(1);
<<<</CHECK_BASH>>>>

chmod +x deploy/check-live.sh deploy/fix-missing-sources.sh
bash -n deploy/check-live.sh && echo "check-live.sh : syntaxe OK"
bash -n deploy/fix-missing-sources.sh && echo "fix-missing-sources.sh : syntaxe OK"
node --check scripts/check-bash.mjs && echo "check-bash.mjs : syntaxe OK"
```

> **Important** : `cat > fichier <<'DELIMITEUR'` doit être collé **en une seule
> fois** (tout le bloc, délimiteur final compris). Un collage partiel produit
> exactement l'erreur `syntax error near unexpected token` vue précédemment.

### 2.4 Cas C — Aucune source nulle part

`fix-missing-sources.sh` affiche `[MANQUANT]` pour chaque fichier absent et
`candidat : /chemin` pour chaque copie complète trouvée sur le disque.

| Sortie | Signification | Suite |
| --- | --- | --- |
| `Les sources sont complètes` | rien à réparer | Étape 3 |
| `candidat : /opt/...` | copie utilisable | `bash deploy/fix-missing-sources.sh --apply` |
| `Aucune autre copie complète` | transfert nécessaire | voir ci-dessous |

Transfert depuis le poste de développement (sources uniquement, **sans**
`node_modules`, `dist`, `.env`) :

```bash
# serveur : préparer la cible
mkdir -p /tmp/uswap-frontend

# poste Windows : créer une archive propre
#   cd "C:\Users\Danielle\Documents\Personnel 2\Internship-project\uswap-github"
#   Compress-Archive frontend_new\frontend\* C:\Temp\uswap-frontend.zip
# puis copier C:\Temp\uswap-frontend.zip sur le serveur (scp / WinSCP / SFTP)

# serveur : déployer
cd /tmp/uswap-frontend && unzip -q -o /tmp/uswap-frontend.zip
ls src/main.tsx src/app/router.tsx vite.config.ts index.html deploy/nginx.conf
cd /opt/uswap && cp -a /tmp/uswap-frontend/. frontend_new/frontend/
rm -rf frontend_new/frontend/node_modules frontend_new/frontend/dist
du -sh frontend_new/frontend/src           # attendu : ~1,6 Mo
```

**Résultat attendu :** `ls src/...` ne renvoie aucune erreur, et `du -sh`
affiche `1.6M` (jamais moins de `200K`).

---

## Étape 3 — Contrôle avant reconstruction

```bash
cd /opt/uswap
bash deploy/check-live.sh
```

Ce premier passage signale l'état actuel (normalement : bundle ancien). On y
lit notamment :

- `sources frontend présentes (~1600 Ko)` → bon signe ;
- `Rôle super administrateur : ABSENT du bundle servi` → l'image est ancienne.

**Résultats possibles de `check-live.sh` :**

| Sortie | Signification | Suite |
| --- | --- | --- |
| Lignes `[INCOHERENT]` | état normal AVANT reconstruction | Étape 4 |
| `sources frontend absentes` puis `[INCOHERENT]` | sources toujours manquantes | retour Étape 2 |
| `AUCUNE INCOHÉRENCE` **déjà** | le serveur est déjà à jour : le problème est le cache navigateur | Étape 7 |
| `http://127.0.0.1:8080/ ne répond pas` | conteneur arrêté | `docker compose ... up -d`, puis relancer |

Puis :

```bash
bash deploy/check-server.sh        # arborescence, .env, ports, migrations
docker compose -f deploy/compose.yaml --env-file deploy/.env config >/dev/null \
  && echo "configuration Compose valide"
```

**Résultat attendu :** `configuration Compose valide` et, dans
`check-server.sh`, aucune ligne `[KO]`.

---

## Étape 4 — Reconstruction SANS cache, avec le journal complet

```bash
cd /opt/uswap
DOCKER_BUILDKIT=1 docker compose -f deploy/compose.yaml --env-file deploy/.env \
  build --no-cache --pull --progress=plain frontend backend 2>&1 | tee /tmp/uswap-build.log
```

**Vérification immédiate — c'est le point décisif :**

```bash
grep -n "transferring context" /tmp/uswap-build.log
```

| Sortie | Signification | Action |
| --- | --- | --- |
| `transferring context: 1.72MB` (frontend) | ✅ le builder reçoit les sources | continuer |
| `transferring context: 8.98kB` | ❌ sources toujours absentes | retour **étape 2**, puis relancer |
| `frontend Built` / `backend Built` (fin de sortie) | ✅ images produites | continuer |
| `ERROR ... failed to compute cache key` | fichier manquant dans le contexte | vérifier `ls frontend_new/frontend` |
| `failed to solve ... npm ci` | `package-lock.json` absent | recopier les sources (étape 2) |

Vérifier aussi que `npm run build` n'est **pas** `CACHED` :

```bash
grep -nE "CACHED.*(npm ci|npm run build)" /tmp/uswap-build.log || echo "aucune étape de build cachée"
```

---

## Étape 5 — Migrations, puis recréation des conteneurs

```bash
cd /opt/uswap
export T="-f deploy/compose.yaml --env-file deploy/.env"

docker compose $T --profile tools run --rm migrate
docker compose $T --profile tools run --rm migrate status

docker compose $T up -d --force-recreate backend frontend
sleep 10
docker compose $T ps
```

**Résultats possibles :**

| Sortie | Signification | Suite |
| --- | --- | --- |
| `No pending migrations to apply` | base déjà à jour (normal) | Étape 6 |
| `Applying migration ...` | migration appliquée | Étape 6 |
| `P3009 / failed migration` | migration en échec | arrêter, prévenir (ne pas faire `reset`) |
| `uswap-db/backend/frontend  Up (healthy)` | les 3 conteneurs tournent | Étape 6 |
| `Restarting` ou `unhealthy` après 30 s | démarrage en échec | `docker compose $T logs --tail=40 backend` |

---

## Étape 6 — Vérification finale serveur

```bash
cd /opt/uswap
bash deploy/check-live.sh
```

**Sortie attendue (succès) :**

```
1/6  frontend conteneur 2026-10-29T... image uswap/frontend:local construite 2026-10-29T...
     src/main.tsx / src/app/router.tsx / src/api/auth-api.ts  [OK]
     sources frontend présentes (1642 Ko)  [OK]
2/6  page servie : http://127.0.0.1:8080/assets/index-AbC123.js (28 chunks référencés)  [OK]
     le bundle servi est bien celui contenu dans le conteneur  [OK]
3/6  rôle super administrateur / fuseau de la station / nettoyage / cartographie / version : présents
4/6  https://<domaine> sert le même bundle que le conteneur  [OK]
5/6  /api/auth/session -> 204 ; /api/me -> 401 ; /api/super-admin/cleanup -> 403
6/6  3 migration(s) appliquée(s) sur 3 versionnée(s)

=========================================================
  AUCUNE INCOHÉRENCE : le serveur sert le code courant.
=========================================================
```

**Si le script affiche ceci, l'intervention est terminée côté serveur** — passer
à l'étape 7 (navigateur). Toute ligne `[INCOHERENT]` indique l'étape à reprendre
dans le « Dépannage rapide » en fin de document.

Contrôle HTTP direct :

```bash
for u in / /app/admin /api/auth/session /api/me; do
  printf '%-22s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080$u)"
done
curl -s http://127.0.0.1:8080/ | grep -o '/assets/index-[^"]*\.js'
```

**Codes attendus :** `/` = 200, `/app/admin` = 200, `/api/auth/session` = 204
(ou 401), `/api/me` = 401. Et un seul nom de fichier `index-XXXX.js` en sortie.

---

## Étape 7 — Vérification navigateur (obligatoire, une fois par navigateur)

1. Ouvrir l'application, **F12** → onglet **Application** → **Service workers**.
2. Cliquer **Unregister** (s'il y en a un).
3. **Ctrl+F5** (rechargement forcé).
4. Aller dans **Compte → Profil** : la ligne **« Version déployée »** doit
   afficher `AAAAMMJJHHMM-<commit>`, identique à :

   ```js
   sessionStorage.getItem('uswap:build'); // console du navigateur
   ```

**Résultats possibles :**

| Ce que vous voyez | Signification | Suite |
| --- | --- | --- |
| Version `202610291430-xxxxxxx` identique au serveur | ✅ déploiement effectif | terminer |
| Version ancienne mais `check-live.sh` vert | cache navigateur | refaire 1-3, ou navigation privée |
| « Version déployée » absente | ancien bundle | retour Étape 4 (build) |

---

## Étape 8 — Empêcher la récidive

```bash
# 1. après CHAQUE déploiement, contrôler la taille du contexte :
grep "transferring context" /tmp/uswap-build.log

# 2. après CHAQUE déploiement, lancer le diagnostic (code 0 = sain) :
cd /opt/uswap && bash deploy/check-live.sh && echo "DÉPLOIEMENT EFFECTIF"
```

**Résultat attendu :** la commande 2 affiche `DÉPLOIEMENT EFFECTIF` (code 0).

Règles :

- ne jamais conclure sur `docker compose ps` seul ;
- ne jamais coller un script `bash` par morceaux : le fichier complet, puis `bash -n` ;
- `check-bash.mjs` (optionnel, depuis le poste) relit les scripts avant de les envoyer :

  ```powershell
  node scripts/check-bash.mjs
  ```

---

## Dépannage rapide

| Message                                        | Cause                                    | Action                                                        |
| ---------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------- |
| `transferring context: 8.98kB`                 | sources absentes                         | étape 2                                                       |
| `CACHED ... npm run build`                     | couche réutilisée malgré `--no-cache`    | ajouter `--pull --progress=plain`, vérifier le contexte       |
| `bash: deploy/check-live.sh: No such file`     | script absent                            | étape 2.3                                                     |
| `syntax error near unexpected token`           | script collé partiellement               | recoller le bloc **entier**, `bash -n`                        |
| `le bundle servi n'est pas celui du conteneur` | autre conteneur / proxy                  | `docker ps`, `nginx -T \| grep proxy_pass`                    |
| `/api/me -> 404`                               | backend d'une ancienne image             | rebuild backend + `up -d --force-recreate backend`            |
| `port is already allocated`                    | 8080/3000 occupés                        | `FRONTEND_HOST_PORT` / `BACKEND_HOST_PORT` dans `deploy/.env` |
| `P3005 database schema is not empty`           | base restaurée sans `_prisma_migrations` | **jamais** `migrate reset` : restaurer le dump de l'étape 0   |

## Retour arrière complet

```bash
cd /opt
mv uswap uswap.broken-$STAMP && mv uswap.backup-$STAMP uswap
cd /opt/uswap && docker compose -f deploy/compose.yaml --env-file deploy/.env up -d
```

Puis, dans le navigateur : Service worker → **Unregister**, **Ctrl+F5**.
