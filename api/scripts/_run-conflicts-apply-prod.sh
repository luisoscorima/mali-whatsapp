#!/usr/bin/env bash
# Apply conflict proposals + deferred unique indexes on production.
# Requires explicit ALLOW_APPLY=1 on the remote node command.
set -euo pipefail
KEY="$HOME/.ssh/primeros_accesos.pem"
HOST="ubuntu@3.210.230.147"
ROOT="/mnt/c/Users/LUIS GUSTAVO/Documents/PROYECTOS ANGULAR/mali-whatsapp"
SRC="$ROOT/api/scripts/leads-conflicts-propose.cjs"
IDX="$ROOT/api/prisma/migrations/20261028120000_leads_additive_lifecycle/deferred_open_unique.sql"
sed -i 's/\r$//' "$SRC" "$IDX" "$0"

scp -i "$KEY" -o StrictHostKeyChecking=accept-new \
  "$SRC" "$IDX" \
  "$HOST:/tmp/"

ssh -i "$KEY" -o StrictHostKeyChecking=accept-new "$HOST" bash -s <<'REMOTE'
set -euo pipefail
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$HOME/mali-whatsapp/backups/leads-conflicts-apply-$STAMP"
mkdir -p "$OUT"
cp /tmp/leads-conflicts-propose.cjs /tmp/deferred_open_unique.sql "$OUT/"

docker cp /tmp/leads-conflicts-propose.cjs mali-whatsapp-api:/app/api/scripts/leads-conflicts-propose.cjs
docker exec mali-whatsapp-api mkdir -p /tmp/conflicts-apply
echo "=== APPLY CONFLICTS ==="
docker exec \
  -e ALLOW_APPLY=1 \
  -e OUTPUT_DIR=/tmp/conflicts-apply \
  -w /app/api \
  mali-whatsapp-api \
  node scripts/leads-conflicts-propose.cjs --apply | tee "$OUT/apply.log"

docker cp mali-whatsapp-api:/tmp/conflicts-apply/. "$OUT/" 2>/dev/null || true

echo "=== PRECHECK BEFORE INDEXES ==="
PGUSER="$(docker exec mali-whatsapp-postgres printenv POSTGRES_USER)"
PGDB="$(docker exec mali-whatsapp-postgres printenv POSTGRES_DB)"
docker exec -i mali-whatsapp-postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 <<'SQL' | tee "$OUT/precheck.sql.txt"
SELECT COUNT(*)::int AS unresolved_conflicts
FROM education_lead_open_conflicts WHERE resolved_at IS NULL;
SELECT COUNT(*)::int AS open_duplicate_groups FROM (
  SELECT 1 FROM education_lead_cycles
  WHERE closed_at IS NULL AND person_id IS NOT NULL
  GROUP BY person_id, business_area_id, program_id
  HAVING COUNT(*) > 1
) d;
SQL

DUPES="$(docker exec mali-whatsapp-postgres psql -U "$PGUSER" -d "$PGDB" -tAc "SELECT COUNT(*) FROM (SELECT 1 FROM education_lead_cycles WHERE closed_at IS NULL AND person_id IS NOT NULL GROUP BY person_id, business_area_id, program_id HAVING COUNT(*) > 1) d")"
if [ "${DUPES// /}" != "0" ]; then
  echo "Refusing indexes: open_duplicate_groups=$DUPES" >&2
  exit 2
fi

echo "=== CREATE UNIQUE INDEXES ==="
docker cp /tmp/deferred_open_unique.sql mali-whatsapp-postgres:/tmp/deferred_open_unique.sql
docker exec mali-whatsapp-postgres \
  psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 \
  -f /tmp/deferred_open_unique.sql | tee "$OUT/indexes.log"

echo "=== POSTCHECK ==="
docker exec -i mali-whatsapp-postgres psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 <<'SQL' | tee "$OUT/postcheck.sql.txt"
SELECT area, key, value FROM app_settings WHERE key = 'leads.attention_v1';
SELECT COUNT(*)::int AS unresolved_conflicts FROM education_lead_open_conflicts WHERE resolved_at IS NULL;
SELECT COUNT(*)::int AS open_duplicate_groups FROM (
  SELECT 1 FROM education_lead_cycles
  WHERE closed_at IS NULL AND person_id IS NOT NULL
  GROUP BY person_id, business_area_id, program_id HAVING COUNT(*) > 1
) d;
SELECT
  COUNT(*) FILTER (WHERE i.relname = 'education_lead_cycles_open_person_program_uq') AS idx_program,
  COUNT(*) FILTER (WHERE i.relname = 'education_lead_cycles_open_person_general_uq') AS idx_general
FROM pg_class i JOIN pg_index x ON x.indexrelid = i.oid
WHERE i.relname IN (
  'education_lead_cycles_open_person_program_uq',
  'education_lead_cycles_open_person_general_uq'
);
SELECT COUNT(*)::int AS alerts_total FROM education_lead_alerts;
SQL

echo "OUT=$OUT"
ls -la "$OUT"
REMOTE
