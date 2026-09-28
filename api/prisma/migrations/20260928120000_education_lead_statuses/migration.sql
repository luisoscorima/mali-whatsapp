-- Catálogo de estados de lead de Educación.
-- Inscripción: Por contactar → Contactado → Evaluando → Promesa → Venta exitosa.
-- Desvíos: No contesta (sigue abierto), No interesado y Perdido (cierran).

INSERT INTO "lead_status_definitions" ("area", "slug", "label", "sort_order", "is_default", "is_terminal", "active")
SELECT a.area, s.slug, s.label, s.sort_order, s.is_default, s.is_terminal, true
FROM (VALUES
  ('educacion'), ('educacion_ca'), ('educacion_ep')
) AS a(area)
CROSS JOIN (VALUES
  ('por_contactar', 'Por contactar', 0, true, false),
  ('contactado', 'Contactado', 10, false, false),
  ('evaluando', 'Evaluando', 20, false, false),
  ('promesa', 'Promesa', 30, false, false),
  ('venta_exitosa', 'Venta exitosa', 40, false, true),
  ('no_contesta', 'No contesta', 50, false, false),
  ('no_interesado', 'No interesado', 60, false, true),
  ('perdido', 'Perdido', 70, false, true)
) AS s(slug, label, sort_order, is_default, is_terminal)
ON CONFLICT ("area", "slug") DO UPDATE SET
  "label" = EXCLUDED."label",
  "sort_order" = EXCLUDED."sort_order",
  "is_default" = EXCLUDED."is_default",
  "is_terminal" = EXCLUDED."is_terminal",
  "active" = true,
  "updated_at" = NOW();

UPDATE "contacts" c
SET "lead_status_id" = dest.id,
    "lead_status_updated_at" = NOW(),
    "updated_at" = NOW()
FROM "lead_status_definitions" src
JOIN "lead_status_definitions" dest
  ON dest.area = src.area
 AND dest.slug = CASE src.slug
   WHEN 'nuevo' THEN 'por_contactar'
   WHEN 'calificado' THEN 'evaluando'
   WHEN 'convertido' THEN 'venta_exitosa'
 END
WHERE c.lead_status_id = src.id
  AND src.area IN ('educacion', 'educacion_ca', 'educacion_ep')
  AND src.slug IN ('nuevo', 'calificado', 'convertido');

UPDATE "education_lead_cycles" cycle
SET "lead_status_id" = dest.id,
    "updated_at" = NOW()
FROM "lead_status_definitions" src
JOIN "lead_status_definitions" dest
  ON dest.area = src.area
 AND dest.slug = CASE src.slug
   WHEN 'nuevo' THEN 'por_contactar'
   WHEN 'calificado' THEN 'evaluando'
   WHEN 'convertido' THEN 'venta_exitosa'
 END
WHERE cycle.lead_status_id = src.id
  AND src.area IN ('educacion', 'educacion_ca', 'educacion_ep')
  AND src.slug IN ('nuevo', 'calificado', 'convertido');

UPDATE "lead_status_definitions"
SET "active" = false, "is_default" = false, "updated_at" = NOW()
WHERE "area" IN ('educacion', 'educacion_ca', 'educacion_ep')
  AND "slug" IN ('nuevo', 'calificado', 'convertido');
