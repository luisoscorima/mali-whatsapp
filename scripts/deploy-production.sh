#!/usr/bin/env bash
# Despliegue en producción: backup → git pull → rebuild app → healthcheck.
# Uso en el servidor (~/mali-whatsapp):
#   ./scripts/deploy-production.sh
#   ./scripts/deploy-production.sh --no-cache
#   ./scripts/deploy-production.sh --skip-backup   # solo si acabas de respaldar
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

echo "[deploy] 3/4 Reconstruir y levantar app…"
BUILD_ARGS=(build)
if [[ "$NO_CACHE" -eq 1 ]]; then
  BUILD_ARGS+=(--no-cache)
fi
BUILD_ARGS+=(app)
$COMPOSE "${BUILD_ARGS[@]}"
$COMPOSE up -d app

echo "[deploy] 4/4 Comprobando /health…"
for i in 1 2 3 4 5 6 7 8 9 10; do
  if $COMPOSE exec -T app node -e "
    require('http').get('http://127.0.0.1:3000/health', (r) => {
      let b = ''; r.on('data', (c) => { b += c; });
      r.on('end', () => process.exit(r.statusCode === 200 && b.includes('\"ok\":true') ? 0 : 1));
    }).on('error', () => process.exit(1));
  " 2>/dev/null; then
    echo "[deploy] Health OK"
    $COMPOSE ps app
    exit 0
  fi
  sleep 2
done

echo "[deploy] ERROR: /health no respondió a tiempo. Revisa: $COMPOSE logs --tail 50 app" >&2
exit 1
