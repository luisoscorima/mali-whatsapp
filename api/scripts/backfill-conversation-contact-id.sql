-- Backfill conversations.contact_id desde contacts del mismo área (phone / BSUID).
-- Solo lectura previa + UPDATE. Ejecutar en el host de prod:
--   docker exec -i mali-whatsapp-postgres psql -U mali_user -d mali_whatsapp -v ON_ERROR_STOP=1 < api/scripts/backfill-conversation-contact-id.sql
--
-- Preferencia: match por whatsapp_user_id, luego phone; contact más reciente.

\pset pager off

SELECT
  COUNT(*) FILTER (WHERE contact_id IS NULL) AS sin_contact_id,
  COUNT(*) AS total
FROM conversations;

BEGIN;

WITH ranked AS (
  SELECT
    c.id AS conversation_id,
    ct.id AS contact_id,
    ROW_NUMBER() OVER (
      PARTITION BY c.id
      ORDER BY
        CASE
          WHEN c.whatsapp_user_id IS NOT NULL
            AND ct.whatsapp_user_id = c.whatsapp_user_id THEN 0
          ELSE 1
        END,
        ct.updated_at DESC NULLS LAST,
        ct.id DESC
    ) AS rn
  FROM conversations c
  JOIN contacts ct
    ON ct.area = c.area
   AND (
     (c.whatsapp_user_id IS NOT NULL AND ct.whatsapp_user_id = c.whatsapp_user_id)
     OR (c.phone IS NOT NULL AND c.phone <> '' AND ct.phone = c.phone)
   )
  WHERE c.contact_id IS NULL
)
UPDATE conversations c
SET contact_id = ranked.contact_id
FROM ranked
WHERE c.id = ranked.conversation_id
  AND ranked.rn = 1
  AND c.contact_id IS NULL;

SELECT
  COUNT(*) FILTER (WHERE contact_id IS NULL) AS sin_contact_id_restantes,
  COUNT(*) AS total
FROM conversations;

COMMIT;
