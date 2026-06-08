#!/usr/bin/env bash
# Respaldo de PostgreSQL (contenedor mali-whatsapp-postgres).
# Uso: desde la raíz del repo → ./scripts/backup-postgres.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/postgres}"
KEEP_BACKUPS="${KEEP_BACKUPS:-14}"
COMPOSE="${COMPOSE:-docker compose}"

mkdir -p "$BACKUP_DIR"
TS="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/mali_whatsapp_${TS}.sql.gz"

echo "[backup] Volcando base de datos → $OUT"
$COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --no-acl' | gzip -9 >"$OUT"

if [[ ! -s "$OUT" ]]; then
  echo "[backup] ERROR: archivo vacío" >&2
  exit 1
fi

echo "[backup] OK ($(du -h "$OUT" | awk '{print $1}'))"

# Conservar solo los últimos N respaldos
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/mali_whatsapp_*.sql.gz 2>/dev/null || true)
if ((${#OLD[@]} > KEEP_BACKUPS)); then
  for f in "${OLD[@]:KEEP_BACKUPS}"; do
    rm -f "$f"
    echo "[backup] Eliminado respaldo antiguo: $(basename "$f")"
  done
fi

echo "[backup] Restaurar (ejemplo): gunzip -c $OUT | $COMPOSE exec -T postgres psql -U \"\$POSTGRES_USER\" -d \"\$POSTGRES_DB\""
