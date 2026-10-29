#!/usr/bin/env bash
# Read-only production smoke. Run on the prod host.
set -uo pipefail
cd "${HOME}/mali-whatsapp" || exit 1

echo "=== HOST / DEPLOY ==="
git rev-parse --short HEAD
git log -1 --oneline
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo

echo "=== HEALTH ==="
docker exec mali-whatsapp-api node -e "fetch('http://127.0.0.1:4000/health').then(async r=>{console.log(await r.text()); if(!r.ok) process.exit(1)}).catch(e=>{console.error(String(e)); process.exit(1)})" || echo 'health_check_failed'
echo

echo "=== SQL READ-ONLY ==="
# Prefer credentials from the postgres container itself (no password parsing).
PGUSER="$(docker exec mali-whatsapp-postgres printenv POSTGRES_USER 2>/dev/null || echo mali)"
PGDB="$(docker exec mali-whatsapp-postgres printenv POSTGRES_DB 2>/dev/null || echo mali_whatsapp)"
echo "psql user=${PGUSER} db=${PGDB}"

docker exec -i mali-whatsapp-postgres \
  psql -U "${PGUSER}" -d "${PGDB}" -v ON_ERROR_STOP=1 <<'SQL'
\pset pager off

SELECT migration_name,
       finished_at IS NOT NULL AS applied,
       rolled_back_at
FROM _prisma_migrations
WHERE migration_name = '20261028120000_leads_additive_lifecycle';

SELECT area, key, COALESCE(value, '') AS value
FROM app_settings
WHERE key = 'leads.attention_v1';

SELECT
  (SELECT COUNT(*) FROM education_lead_cycles) AS total_cycles,
  (SELECT COUNT(*) FROM education_lead_cycles WHERE closed_at IS NULL) AS open_cycles,
  (SELECT COUNT(*) FROM education_lead_cycles WHERE person_id IS NULL) AS missing_person,
  (SELECT COUNT(*) FROM education_lead_cycles
     WHERE closed_at IS NULL
       AND inactivity_deadline_at IS NOT NULL
       AND inactivity_deadline_at <= NOW()) AS auto_expire_due,
  (SELECT COUNT(*) FROM education_lead_cycles
     WHERE closed_at IS NULL
       AND inactivity_deadline_at IS NULL
       AND last_interaction_at <= NOW() - INTERVAL '60 days') AS historical_60d_no_deadline,
  (SELECT COUNT(*) FROM education_lead_cycles
     WHERE closed_at IS NULL AND lead_status_id IS NULL) AS open_without_status,
  (SELECT COUNT(*) FROM education_lead_alerts) AS alerts_total,
  (SELECT COUNT(*) FROM education_lead_open_conflicts
     WHERE resolved_at IS NULL) AS unresolved_conflicts;

SELECT
  COUNT(*) FILTER (WHERE i.relname = 'education_lead_cycles_open_person_program_uq') AS idx_program,
  COUNT(*) FILTER (WHERE i.relname = 'education_lead_cycles_open_person_general_uq') AS idx_general
FROM pg_class i
JOIN pg_index x ON x.indexrelid = i.oid
WHERE i.relname IN (
  'education_lead_cycles_open_person_program_uq',
  'education_lead_cycles_open_person_general_uq'
);

WITH groups AS (
  SELECT person_id, business_area_id, program_id,
         COUNT(*) AS n,
         COUNT(DISTINCT COALESCE(assigned_user_id::text, '<sin>')) AS advisors_null_aware,
         COUNT(DISTINCT COALESCE(lead_status_id::text, '<sin>')) AS statuses_null_aware
  FROM education_lead_cycles
  WHERE closed_at IS NULL AND person_id IS NOT NULL
  GROUP BY person_id, business_area_id, program_id
  HAVING COUNT(*) > 1
)
SELECT
  COUNT(*) AS unique_conflict_groups,
  COUNT(*) FILTER (WHERE advisors_null_aware > 1 OR statuses_null_aware > 1) AS manual_null_aware,
  COUNT(*) FILTER (WHERE advisors_null_aware = 1 AND statuses_null_aware = 1) AS same_management_candidates,
  COALESCE(SUM(n), 0) AS conflicting_cycles
FROM groups;
SQL
