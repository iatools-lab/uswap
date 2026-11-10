#!/usr/bin/env bash
# =============================================================================
# uSwap — retour arriere (rollback).
#
#   sudo bash deploy/rollback.sh --list              # versions disponibles
#   sudo bash deploy/rollback.sh --tag <commit>      # revenir a un commit
#   sudo bash deploy/rollback.sh --backup-db         # sauvegarder la base
#   sudo bash deploy/rollback.sh --restore-db <fichier.dump>
#   bash deploy/rollback.sh --help
#
# REGLES DE SECURITE (jamais contournees par ce script) :
#   - aucun volume Docker n'est supprime ;
#   - `docker compose down -v` n'est jamais execute ;
#   - la base n'est restauree que sur demande explicite (--restore-db) ;
#   - une sauvegarde est prise AVANT tout changement de version ;
#   - la configuration Apache existante n'est pas modifiee.
#
# Ce script est INDEPENDANT de deploy.sh : il n'utilise ni branche de
# secours, ni force-push. Le code revient par `git checkout <commit>`
# (detached HEAD), ce qui ne reecrit AUCUN historique.
# =============================================================================

set -euo pipefail

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
BACKUP_DIR="${USWAP_BACKUP_DIR:-$ROOT/var/backups}"
T=(-f "$COMPOSE" --env-file "$ENV_FILE")

[ -f "$ENV_FILE" ] || die "deploy/.env introuvable : rien a restaurer"

get_env() { sed -n "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//p" "$ENV_FILE" | head -n1 | tr -d '\r"' ; }
PG_USER="$(get_env POSTGRES_USER)"; PG_USER="${PG_USER:-uswap}"
PG_DB="$(get_env POSTGRES_DB)"; PG_DB="${PG_DB:-uswap}"

usage() {
  sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

backup_db() {
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  local file="$BACKUP_DIR/uswap-$(date +%Y%m%d-%H%M%S).dump"
  step "Sauvegarde de la base"
  docker compose "${T[@]}" exec -T db pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$file"
  ok "sauvegarde ecrite : $file ($(du -h "$file" | cut -f1))"
}

restore_db() {
  local file="$1"
  [ -f "$file" ] || die "fichier de sauvegarde introuvable : $file"
  step "Restauration de la base depuis $file"
  warn "le backend va etre arrete pendant la restauration (donnees conservees sur disque)"
  docker compose "${T[@]}" stop backend >/dev/null 2>&1 || true
  # --clean --if-exists : remet la base dans l'etat du dump, sans toucher aux
  # volumes Docker. Le volume uswap-pgdata n'est jamais supprime.
  cat "$file" | docker compose "${T[@]}" exec -T db pg_restore -U "$PG_USER" -d "$PG_DB" --clean --if-exists
  docker compose "${T[@]}" up -d backend >/dev/null
  ok "base restauree ; backend redemarre"
}

case "${1:-}" in
  --help|-h) usage ;;
  --list)
    step "Versions disponibles (20 derniers commits de develop)"
    git log --oneline -20 --decorate develop
    printf '\n'
    ok "pour revenir : sudo bash deploy/rollback.sh --tag <commit>"
    ;;
  --backup-db)
    backup_db
    ;;
  --restore-db)
    [ -n "${2:-}" ] || die "usage : sudo bash deploy/rollback.sh --restore-db <fichier.dump>"
    restore_db "$2"
    ;;
  --tag)
    TAG="${2:-}"
    [ -n "$TAG" ] || die "usage : sudo bash deploy/rollback.sh --tag <commit>"
    git cat-file -e "$TAG^{commit}" 2>/dev/null || die "commit inconnu : $TAG (voir --list)"

    CURRENT="$(git rev-parse --short HEAD)"
    step "Retour arriere $CURRENT -> $TAG"
    warn "les fichiers non commites seront refuses : commit ou sauvegarde-les d'abord"
    [ -z "$(git status --porcelain)" ] || die "arbre de travail modifie : 'git status' puis commit avant de revenir en arriere"

    backup_db

    git checkout --detach "$TAG"
    ok "code positionne sur $TAG (detached HEAD : aucun historique reecrit)"

    step "Reconstruction des images"
    docker compose "${T[@]}" build backend frontend
    ok "images reconstruites"

    step "Redemarrage (volumes et donnees conserves)"
    docker compose "${T[@]}" up -d
    docker compose "${T[@]}" ps

    printf '\n%s  RETOUR ARRIERE TERMINE%s\n' "$G" "$N"
    cat <<EOF

  Code      : $TAG (detached HEAD)
  Donnees   : conservees (aucun volume supprime)
  Sauvegarde: $BACKUP_DIR

  Pour revenir a la version courante de develop :
    cd $ROOT && git checkout develop && sudo bash deploy/deploy.sh

EOF
    ;;
  *) usage ;;
esac
