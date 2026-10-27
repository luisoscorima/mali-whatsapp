-- Plantillas identificadas por WABA + nombre + idioma (no solo por área).

-- Backfill desde la línea predeterminada del área; si no hay, cualquier línea del área.
UPDATE "whatsapp_templates" t
SET "whatsapp_waba_id" = src.waba_id
FROM (
  SELECT DISTINCT ON (ba.slug)
    ba.slug AS area_slug,
    wl.waba_id
  FROM whatsapp_lines wl
  JOIN business_areas ba ON ba.id = wl.business_area_id
  WHERE wl.waba_id IS NOT NULL
  ORDER BY ba.slug, wl.is_default DESC, wl.id ASC
) src
WHERE t.whatsapp_waba_id IS NULL
  AND t.area = src.area_slug;

-- Filas huérfanas: WABA global más antigua (último recurso antes de NOT NULL).
UPDATE "whatsapp_templates" t
SET "whatsapp_waba_id" = (
  SELECT w.id FROM whatsapp_wabas w ORDER BY w.id ASC LIMIT 1
)
WHERE t.whatsapp_waba_id IS NULL
  AND EXISTS (SELECT 1 FROM whatsapp_wabas LIMIT 1);

-- Si aún queda null y no hay WABAs, eliminar huérfanas inviables.
DELETE FROM "whatsapp_templates" WHERE "whatsapp_waba_id" IS NULL;

ALTER TABLE "whatsapp_templates"
  ALTER COLUMN "whatsapp_waba_id" SET NOT NULL;

ALTER TABLE "whatsapp_templates"
  DROP CONSTRAINT IF EXISTS "whatsapp_templates_area_name_language_key";

CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_templates_whatsapp_waba_id_name_language_key"
  ON "whatsapp_templates" ("whatsapp_waba_id", "name", "language");
