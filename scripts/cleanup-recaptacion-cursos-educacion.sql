-- =============================================================================
-- Limpieza one-off: segmento malformado recaptacion_cursos (área Educación)
-- =============================================================================
--
-- Alcance
--   area         = 'educacion'   (NO educacion_ca / educacion_ep)
--   segment_slug = 'recaptacion_cursos'
--
-- Qué borra
--   1) conversations (+ CASCADE chat_messages, conversation_tags, leads CTWA)
--      de contactos/phones de ese segmento en educacion
--   2) contacts de ese segmento (+ CASCADE contact_segments, contact_attributes)
--      campaign_logs.contact_id / conversations restantes → SET NULL (no aplica
--      si ya borramos las conversaciones)
--
-- Qué NO borra
--   - Campañas ni campaign_logs
--   - segment_definitions (el slug queda vacío; borrar desde UI si quieren)
--   - Contactos/conversaciones de recap_oficial u otras áreas
--
-- Cómo ejecutar (producción o local)
--   1) Backup recomendado: ./scripts/backup-postgres.sh (o dump manual)
--   2) Dry-run: ejecutar SOLO la sección 1 (SELECT) y revisar conteos/muestra
--   3) Si la sección 2 (multi-segmento) devuelve filas → ABORTAR y revisar a mano
--   4) Sección 3: dejar ROLLBACK al final la primera vez; si los conteos del
--      DELETE y la verificación cuadran, cambiar ROLLBACK por COMMIT y re-ejecutar
--
-- Ejemplo psql (ajustar connection string):
--   psql "$DATABASE_URL" -f scripts/cleanup-recaptacion-cursos-educacion.sql
--   o pegar por bloques en un cliente SQL
--
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) DRY-RUN — conteos y muestra (seguro; no modifica datos)
-- ---------------------------------------------------------------------------

-- Contactos en el segmento erróneo
SELECT COUNT(*) AS contacts_in_segment
FROM contact_segments cs
WHERE cs.area = 'educacion'
  AND cs.segment_slug = 'recaptacion_cursos';

-- Muestra (nombre + phone) — revisar prefijos raros (52, 53, …)
SELECT
  c.id,
  c.name,
  c.last_name,
  c.phone,
  c.segment AS legacy_segment,
  c.active
FROM contacts c
INNER JOIN contact_segments cs
  ON cs.contact_id = c.id
WHERE cs.area = 'educacion'
  AND cs.segment_slug = 'recaptacion_cursos'
ORDER BY c.id
LIMIT 50;

-- Conversaciones que se borrarían (por contact_id o por phone del segmento)
SELECT COUNT(*) AS conversations_to_delete
FROM conversations conv
WHERE conv.area = 'educacion'
  AND (
    conv.contact_id IN (
      SELECT cs.contact_id
      FROM contact_segments cs
      WHERE cs.area = 'educacion'
        AND cs.segment_slug = 'recaptacion_cursos'
    )
    OR conv.phone IN (
      SELECT c.phone
      FROM contacts c
      INNER JOIN contact_segments cs ON cs.contact_id = c.id
      WHERE cs.area = 'educacion'
        AND cs.segment_slug = 'recaptacion_cursos'
        AND c.area = 'educacion'
    )
  );

-- Mensajes de chat afectados (vía esas conversaciones)
SELECT COUNT(*) AS chat_messages_to_delete
FROM chat_messages cm
WHERE cm.conversation_id IN (
  SELECT conv.id
  FROM conversations conv
  WHERE conv.area = 'educacion'
    AND (
      conv.contact_id IN (
        SELECT cs.contact_id
        FROM contact_segments cs
        WHERE cs.area = 'educacion'
          AND cs.segment_slug = 'recaptacion_cursos'
      )
      OR conv.phone IN (
        SELECT c.phone
        FROM contacts c
        INNER JOIN contact_segments cs ON cs.contact_id = c.id
        WHERE cs.area = 'educacion'
          AND cs.segment_slug = 'recaptacion_cursos'
          AND c.area = 'educacion'
      )
    )
);

-- ---------------------------------------------------------------------------
-- 2) SEGURIDAD — contactos del segmento con OTROS segmentos también
--    Si este SELECT devuelve filas: NO ejecutar la sección 3.
-- ---------------------------------------------------------------------------

SELECT
  c.id,
  c.name,
  c.phone,
  ARRAY_AGG(cs2.segment_slug ORDER BY cs2.segment_slug) AS all_segments
FROM contacts c
INNER JOIN contact_segments cs_bad
  ON cs_bad.contact_id = c.id
 AND cs_bad.area = 'educacion'
 AND cs_bad.segment_slug = 'recaptacion_cursos'
INNER JOIN contact_segments cs2
  ON cs2.contact_id = c.id
GROUP BY c.id, c.name, c.phone
HAVING COUNT(*) > 1
   OR BOOL_OR(cs2.segment_slug <> 'recaptacion_cursos');

-- ---------------------------------------------------------------------------
-- 3) BORRADO — transacción
--    Primera pasada: dejar ROLLBACK.
--    Si todo cuadra: cambiar la última línea a COMMIT y re-ejecutar solo §3.
-- ---------------------------------------------------------------------------

BEGIN;

-- Temp con ids/phones del segmento (snapshot al inicio de la tx)
CREATE TEMP TABLE _cleanup_recaptacion_cursos ON COMMIT DROP AS
SELECT c.id AS contact_id, c.phone
FROM contacts c
INNER JOIN contact_segments cs ON cs.contact_id = c.id
WHERE cs.area = 'educacion'
  AND cs.segment_slug = 'recaptacion_cursos'
  AND c.area = 'educacion';

-- Abortar si hay multi-segmento (mismo criterio que §2)
DO $$
DECLARE
  multi_count INT;
BEGIN
  SELECT COUNT(*) INTO multi_count
  FROM (
    SELECT c.id
    FROM contacts c
    INNER JOIN _cleanup_recaptacion_cursos t ON t.contact_id = c.id
    INNER JOIN contact_segments cs2 ON cs2.contact_id = c.id
    GROUP BY c.id
    HAVING COUNT(*) > 1
       OR BOOL_OR(cs2.segment_slug <> 'recaptacion_cursos')
  ) x;

  IF multi_count > 0 THEN
    RAISE EXCEPTION
      'Abortado: % contacto(s) de recaptacion_cursos tienen otros segmentos. Revisar §2.',
      multi_count;
  END IF;
END $$;

-- 3a) Conversaciones primero (CASCADE mensajes)
WITH deleted AS (
  DELETE FROM conversations conv
  WHERE conv.area = 'educacion'
    AND (
      conv.contact_id IN (SELECT contact_id FROM _cleanup_recaptacion_cursos)
      OR conv.phone IN (SELECT phone FROM _cleanup_recaptacion_cursos)
    )
  RETURNING conv.id
)
SELECT COUNT(*) AS conversations_deleted FROM deleted;

-- 3b) Contactos (CASCADE contact_segments / attributes)
WITH deleted AS (
  DELETE FROM contacts c
  WHERE c.id IN (SELECT contact_id FROM _cleanup_recaptacion_cursos)
  RETURNING c.id
)
SELECT COUNT(*) AS contacts_deleted FROM deleted;

-- Verificación dentro de la misma tx (debe ser 0)
SELECT COUNT(*) AS remaining_segment_memberships
FROM contact_segments
WHERE area = 'educacion'
  AND segment_slug = 'recaptacion_cursos';

SELECT COUNT(*) AS remaining_conversations_for_snapshot_phones
FROM conversations conv
WHERE conv.area = 'educacion'
  AND conv.phone IN (SELECT phone FROM _cleanup_recaptacion_cursos);

-- Primera vez: ROLLBACK. Cuando los conteos sean correctos: COMMIT.
ROLLBACK;
--COMMIT;
