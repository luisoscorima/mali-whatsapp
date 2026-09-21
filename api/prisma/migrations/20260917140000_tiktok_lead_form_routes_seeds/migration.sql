-- Forms TikTok del Lead Center (MALI Cursos de Arte y Extensión Profesional).
-- Lead Management v2 no expone listado de Instant Forms; sync decora vía page/field/get.
INSERT INTO "tiktok_lead_form_routes" ("form_id", "area", "form_name", "area_locked", "updated_at")
VALUES
  ('7667121280713359637', 'educacion_ca', 'Cursos de Arte - Bailes y Danzas - Jul 2026', false, CURRENT_TIMESTAMP),
  ('7672269854711382293', 'educacion_ca', 'Cursos de Arte - Artes Vocales - Ago', false, CURRENT_TIMESTAMP),
  ('7667121851457454357', 'educacion_ca', NULL, false, CURRENT_TIMESTAMP),
  ('7667110589914874133', 'educacion_ca', NULL, false, CURRENT_TIMESTAMP),
  ('7664781771598446855', 'educacion_ep', '[FORM EP] - Cursos Libres - JULIO', false, CURRENT_TIMESTAMP),
  ('7664789039060500744', 'educacion_ep', '[FORM EP] - CI & GC - JULIO Copia', false, CURRENT_TIMESTAMP),
  ('7664792340623687943', 'educacion_ep', '[FORM EP] - Cursos de PEGC- JULIO Copia', false, CURRENT_TIMESTAMP),
  ('7664791301954683154', 'educacion_ep', NULL, false, CURRENT_TIMESTAMP),
  ('7664751627492065544', 'educacion', NULL, false, CURRENT_TIMESTAMP)
ON CONFLICT ("form_id") DO NOTHING;
