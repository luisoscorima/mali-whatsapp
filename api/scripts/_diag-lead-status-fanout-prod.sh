#!/usr/bin/env bash
# Read-only: contact.lead_status fan-out across WhatsApp lines (Educación).
set -euo pipefail
cd "${HOME}/mali-whatsapp"

PGUSER="$(docker exec mali-whatsapp-postgres printenv POSTGRES_USER)"
PGDB="$(docker exec mali-whatsapp-postgres printenv POSTGRES_DB)"
echo "psql user=${PGUSER} db=${PGDB}"
echo "git=$(git rev-parse --short HEAD 2>/dev/null || echo '?') $(git log -1 --oneline 2>/dev/null || true)"
echo

docker exec -i mali-whatsapp-postgres \
  psql -U "${PGUSER}" -d "${PGDB}" -v ON_ERROR_STOP=1 <<'SQL'
\pset pager off
\pset format aligned

-- Totales
SELECT
  COUNT(*) FILTER (WHERE event_type = 'contact.lead_status') AS status_events,
  COUNT(*) FILTER (
    WHERE event_type = 'contact.lead_status'
      AND NULLIF(meta->>'conversation_id','') IS NULL
  ) AS status_without_conversation_id,
  COUNT(*) FILTER (
    WHERE event_type = 'contact.lead_status'
      AND NULLIF(meta->>'cycle_id','') IS NULL
  ) AS status_without_cycle_id,
  COUNT(*) FILTER (WHERE event_type = 'contact.lead_score') AS score_events
FROM audit_logs
WHERE area = 'educacion';

-- Contactos con varias conversaciones (líneas) + eventos de estado
WITH multi AS (
  SELECT c.contact_id, COUNT(*) AS conversations
  FROM conversations c
  WHERE c.area = 'educacion' AND c.contact_id IS NOT NULL
  GROUP BY c.contact_id
  HAVING COUNT(*) >= 2
),
status_ev AS (
  SELECT
    (meta->>'contact_id')::int AS contact_id,
    COUNT(*) AS status_events,
    COUNT(*) FILTER (WHERE NULLIF(meta->>'conversation_id','') IS NULL) AS missing_conv,
    COUNT(*) FILTER (WHERE NULLIF(meta->>'cycle_id','') IS NULL) AS missing_cycle
  FROM audit_logs
  WHERE area = 'educacion'
    AND event_type = 'contact.lead_status'
    AND NULLIF(meta->>'contact_id','') IS NOT NULL
  GROUP BY 1
)
SELECT
  m.contact_id,
  ct.name || ' ' || COALESCE(ct.last_name,'') AS contact_name,
  ct.phone,
  m.conversations AS lines,
  s.status_events,
  s.missing_conv,
  s.missing_cycle
FROM multi m
JOIN status_ev s ON s.contact_id = m.contact_id
LEFT JOIN contacts ct ON ct.id = m.contact_id
ORDER BY s.status_events DESC, m.conversations DESC
LIMIT 40;

-- ¿Cuántos de esos contactos multi-línea existen?
SELECT COUNT(*) AS multi_line_contacts_with_status_events
FROM (
  SELECT c.contact_id
  FROM conversations c
  WHERE c.area = 'educacion' AND c.contact_id IS NOT NULL
  GROUP BY c.contact_id
  HAVING COUNT(*) >= 2
) m
WHERE EXISTS (
  SELECT 1 FROM audit_logs a
  WHERE a.area = 'educacion'
    AND a.event_type = 'contact.lead_status'
    AND (a.meta->>'contact_id')::int = m.contact_id
);

-- Recuperabilidad: eventos sin conversation_id pero con cycle_id usable
SELECT
  COUNT(*) AS status_missing_conv_with_cycle,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1
      FROM education_lead_conversation_links l
      WHERE l.cycle_id = (a.meta->>'cycle_id')::bigint
    )
  ) AS cycle_has_any_link,
  COUNT(*) FILTER (
    WHERE (
      SELECT COUNT(DISTINCT l.conversation_id)
      FROM education_lead_conversation_links l
      WHERE l.cycle_id = (a.meta->>'cycle_id')::bigint
        AND l.unlinked_at IS NULL
    ) = 1
  ) AS uniquely_linkable
FROM audit_logs a
WHERE a.area = 'educacion'
  AND a.event_type = 'contact.lead_status'
  AND NULLIF(a.meta->>'conversation_id','') IS NULL
  AND NULLIF(a.meta->>'cycle_id','') IS NOT NULL;

-- Recuperabilidad: sin cycle ni conversation — solo contact_id
SELECT COUNT(*) AS status_only_contact_id
FROM audit_logs
WHERE area = 'educacion'
  AND event_type = 'contact.lead_status'
  AND NULLIF(meta->>'conversation_id','') IS NULL
  AND NULLIF(meta->>'cycle_id','') IS NULL
  AND NULLIF(meta->>'contact_id','') IS NOT NULL;

-- Contactos con lead_status_id aún en contacts (espejo legacy)
SELECT COUNT(*) AS contacts_with_legacy_lead_status
FROM contacts
WHERE area = 'educacion' AND lead_status_id IS NOT NULL;
SQL
