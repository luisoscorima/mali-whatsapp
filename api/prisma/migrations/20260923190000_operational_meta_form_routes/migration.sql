-- Catálogo local: solo los formularios aprobados por MALI aparecen en la vista operativa.
-- Las rutas históricas se conservan para resolver leads antiguos y no se eliminan.
ALTER TABLE "meta_lead_form_routes"
  ADD COLUMN "is_operational" BOOLEAN NOT NULL DEFAULT false;

-- Formularios Meta actualmente operativos confirmados por MALI.
INSERT INTO "meta_lead_form_routes"
  ("form_id", "area", "form_name", "area_locked", "is_operational", "updated_at")
VALUES
  ('1319629646822014', 'educacion_ca', 'Cursos de Arte - Artes Manuales - Jul 2026', true, true, CURRENT_TIMESTAMP),
  ('2094341928151692', 'educacion_ca', 'Cursos de Arte - Artes Musciales - Jul 2026', true, true, CURRENT_TIMESTAMP),
  ('1021260787379658', 'educacion_ca', 'Cursos de Arte - Artes Marciales - Jul 2026', true, true, CURRENT_TIMESTAMP),
  ('4477972115802949', 'educacion_ca', 'Cursos de Arte - Artes Gráficas - Jul 2026', true, true, CURRENT_TIMESTAMP),
  ('1048121724426170', 'educacion_ca', 'Cursos de Arte - Artes Escénicas - Jul 2026', true, true, CURRENT_TIMESTAMP),
  ('1061540713240259', 'educacion_ca', 'Cursos de Arte - Bailes y Danzas - Jul 2026', true, true, CURRENT_TIMESTAMP),
  ('1678089499945954', 'educacion_ca', 'Cursos de Arte - Artes Vocales - Jul 2026', true, true, CURRENT_TIMESTAMP),
  ('1563340038568800', 'educacion_ca', 'Cursos de Arte - Artes Plásticas - Jul 2026', true, true, CURRENT_TIMESTAMP),
  ('1577538393930907', 'educacion_ep', '[FORM EP] - Cursos libres-JUNIO', true, true, CURRENT_TIMESTAMP),
  ('1554038006084449', 'educacion_ep', '[FORM EP] - CI & GC-JUNIO-copy', true, true, CURRENT_TIMESTAMP),
  ('1520077659523253', 'educacion_ep', '[FORM EP] - Cursos de PEGC-JUNIO', true, true, CURRENT_TIMESTAMP)
ON CONFLICT ("form_id") DO UPDATE
SET
  "area" = EXCLUDED."area",
  "form_name" = EXCLUDED."form_name",
  "area_locked" = true,
  "is_operational" = true,
  "updated_at" = CURRENT_TIMESTAMP;
