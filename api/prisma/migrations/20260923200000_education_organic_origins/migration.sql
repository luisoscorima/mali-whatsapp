-- One organic origin per historical education conversation with inbound messages.
-- Contacts already attributed to another source keep that attribution.
WITH inbound AS (
  SELECT c.id AS conversation_id,
         c.area,
         c.phone,
         c.contact_id,
         MIN(m.created_at) AS first_seen_at,
         MAX(m.created_at) AS last_seen_at
  FROM conversations c
  JOIN chat_messages m ON m.conversation_id = c.id AND m.direction = 'inbound'
  WHERE c.area IN ('educacion', 'educacion_ca', 'educacion_ep')
  GROUP BY c.id, c.area, c.phone, c.contact_id
), candidates AS (
  SELECT i.*,
         COALESCE(i.contact_id, matched.id) AS resolved_contact_id
  FROM inbound i
  LEFT JOIN LATERAL (
    SELECT id
    FROM contacts
    WHERE area = i.area AND phone = i.phone AND replaced_at IS NULL
    ORDER BY id DESC
    LIMIT 1
  ) matched ON TRUE
)
INSERT INTO contact_origins (
  area, contact_id, channel, external_id, source_label,
  phone, conversation_id, first_seen_at, last_seen_at, created_at, updated_at
)
SELECT c.area, c.resolved_contact_id, 'organic_wa',
       'conversation:' || c.conversation_id::text, 'WhatsApp orgánico',
       c.phone, c.conversation_id, c.first_seen_at, c.last_seen_at,
       NOW(), NOW()
FROM candidates c
WHERE NOT EXISTS (
  SELECT 1
  FROM contact_origins o
  WHERE o.area = c.area AND o.channel <> 'organic_wa'
    AND (o.conversation_id = c.conversation_id
      OR (c.resolved_contact_id IS NOT NULL AND o.contact_id = c.resolved_contact_id))
)
ON CONFLICT (area, channel, external_id) DO NOTHING;
