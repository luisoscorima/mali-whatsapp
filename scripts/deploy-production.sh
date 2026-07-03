#!/usr/bin/env bash
# Despliegue en producción v2: backup → git pull → rebuild api+web → up → /health.
# Uso en el servidor (~/mali-whatsapp):
#   ./scripts/deploy-production.sh
#   ./scripts/deploy-production.sh --no-cache
#   ./scripts/deploy-production.sh --skip-backup
#   BRANCH=migrate/v2 ./scripts/deploy-production.sh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

BRANCH="${BRANCH:-main}"
COMPOSE="${COMPOSE:-docker compose}"
SKIP_BACKUP=0
NO_CACHE=0

for arg in "$@"; do
  case "$arg" in
    --skip-backup) SKIP_BACKUP=1 ;;
    --no-cache) NO_CACHE=1 ;;
    -h|--help)
      echo "Uso: $0 [--no-cache] [--skip-backup]"
      echo "Variables: BRANCH (default: main), COMPOSE (default: docker compose)"
      exit 0
      ;;
    *)
      echo "Opción desconocida: $arg" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f .env ]]; then
  echo "[deploy] ERROR: falta .env en $ROOT_DIR" >&2
  exit 1
fi

if [[ "$SKIP_BACKUP" -eq 0 ]]; then
  echo "[deploy] 1/4 Respaldo PostgreSQL…"
  "$ROOT_DIR/scripts/backup-postgres.sh"
else
  echo "[deploy] 1/4 Respaldo omitido (--skip-backup)"
fi

echo "[deploy] 2/4 git pull origin $BRANCH…"
git fetch origin
git pull origin "$BRANCH"

echo "[deploy] 3/4 Reconstruir y levantar api + web (+ postgres, redis)…"
BUILD_ARGS=(build)
if [[ "$NO_CACHE" -eq 1 ]]; then
  BUILD_ARGS+=(--no-cache)
fi
BUILD_ARGS+=(api web)
$COMPOSE "${BUILD_ARGS[@]}"
$COMPOSE up -d

echo "[deploy] 4/4 Comprobando /health (API :4000)…"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if $COMPOSE exec -T api node -e "
    require('http').get('http://127.0.0.1:4000/health', (r) => {
      let b = ''; r.on('data', (c) => { b += c; });
      r.on('end', () => process.exit(r.statusCode === 200 && b.includes('\"ok\":true') ? 0 : 1));
    }).on('error', () => process.exit(1));
  " 2>/dev/null; then
    echo "[deploy] Health OK"
    $COMPOSE ps api web redis postgres
    exit 0
  fi
  sleep 2
done

echo "[deploy] ERROR: /health no respondió a tiempo. Revisa:" >&2
echo "  $COMPOSE logs --tail 80 api" >&2
echo "  $COMPOSE logs --tail 30 web" >&2
exit 1
