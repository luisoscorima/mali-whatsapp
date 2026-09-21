-- Formularios activos confirmados: ruta explícita hacia el área/número de WhatsApp.
-- Las rutas bloqueadas prevalecen sobre la inferencia por nombre. Los formularios
-- nuevos no incluidos conservan el fallback existente: nombre y luego Educación.

INSERT INTO "meta_lead_form_routes"
  ("form_id", "area", "form_name", "area_locked", "updated_at")
VALUES
  ('1319629646822014', 'educacion_ca', 'Cursos de Arte - Artes Manuales - Jul 2026', true, CURRENT_TIMESTAMP),
  ('2094341928151692', 'educacion_ca', 'Cursos de Arte - Artes Musciales - Jul 2026', true, CURRENT_TIMESTAMP),
  ('1021260787379658', 'educacion_ca', 'Cursos de Arte - Artes Marciales - Jul 2026', true, CURRENT_TIMESTAMP),
  ('4477972115802949', 'educacion_ca', 'Cursos de Arte - Artes Gráficas - Jul 2026', true, CURRENT_TIMESTAMP),
  ('1048121724426170', 'educacion_ca', 'Cursos de Arte - Artes Escénicas - Jul 2026', true, CURRENT_TIMESTAMP),
  ('1061540713240259', 'educacion_ca', 'Cursos de Arte - Bailes y Danzas - Jul 2026', true, CURRENT_TIMESTAMP),
  ('1678089499945954', 'educacion_ca', 'Cursos de Arte - Artes Vocales - Jul 2026', true, CURRENT_TIMESTAMP),
  ('1563340038568800', 'educacion_ca', 'Cursos de Arte - Artes Plásticas - Jul 2026', true, CURRENT_TIMESTAMP),
  ('1577538393930907', 'educacion_ep', '[FORM EP] - Cursos libres-JUNIO', true, CURRENT_TIMESTAMP),
  ('1554038006084449', 'educacion_ep', '[FORM EP] - CI & GC-JUNIO-copy', true, CURRENT_TIMESTAMP),
  ('1520077659523253', 'educacion_ep', '[FORM EP] - Cursos de PEGC-JUNIO', true, CURRENT_TIMESTAMP)
ON CONFLICT ("form_id") DO UPDATE
SET
  "area" = EXCLUDED."area",
  "form_name" = EXCLUDED."form_name",
  "area_locked" = true,
  "updated_at" = CURRENT_TIMESTAMP;

INSERT INTO "tiktok_lead_form_routes"
  ("form_id", "area", "form_name", "area_locked", "updated_at")
VALUES
  ('7667121280713359637', 'educacion_ca', 'Cursos de Arte - Bailes y Danzas - Jul 2026', true, CURRENT_TIMESTAMP),
  ('7672269854711382293', 'educacion_ca', 'Cursos de Arte - Artes Vocales - Ago', true, CURRENT_TIMESTAMP),
  ('7664781771598446855', 'educacion_ep', '[FORM EP] - Cursos libres - JULIO', true, CURRENT_TIMESTAMP),
  ('7664789039060500744', 'educacion_ep', '[FORM EP] - CI & GC - JULIO Copia', true, CURRENT_TIMESTAMP),
  ('7664792340623687943', 'educacion_ep', '[FORM EP] - Cursos de PEGC-JULIO Copia', true, CURRENT_TIMESTAMP)
ON CONFLICT ("form_id") DO UPDATE
SET
  "area" = EXCLUDED."area",
  "form_name" = EXCLUDED."form_name",
  "area_locked" = true,
  "updated_at" = CURRENT_TIMESTAMP;
