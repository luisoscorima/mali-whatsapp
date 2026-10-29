#!/usr/bin/env bash
set -euo pipefail
KEY="$HOME/.ssh/primeros_accesos.pem"
HOST="ubuntu@3.210.230.147"
SRC="/mnt/c/Users/LUIS GUSTAVO/Documents/PROYECTOS ANGULAR/mali-whatsapp/api/scripts/leads-conflicts-propose.cjs"
sed -i 's/\r$//' "$SRC"
scp -i "$KEY" -o StrictHostKeyChecking=accept-new "$SRC" "$HOST:/tmp/leads-conflicts-propose.cjs"
ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$HOST" bash -s <<'REMOTE'
set -euo pipefail
mkdir -p "$HOME/mali-whatsapp/backups/leads-conflicts-propose-$(date -u +%Y%m%d)"
OUT="$HOME/mali-whatsapp/backups/leads-conflicts-propose-$(date -u +%Y%m%d)"
docker cp /tmp/leads-conflicts-propose.cjs mali-whatsapp-api:/app/api/scripts/leads-conflicts-propose.cjs
docker exec -e OUTPUT_DIR=/tmp/conflicts-propose mali-whatsapp-api mkdir -p /tmp/conflicts-propose
docker exec -e OUTPUT_DIR=/tmp/conflicts-propose -w /app/api mali-whatsapp-api \
  node scripts/leads-conflicts-propose.cjs
docker cp mali-whatsapp-api:/tmp/conflicts-propose/. "$OUT/"
echo "OUT=$OUT"
ls -la "$OUT"
REMOTE
