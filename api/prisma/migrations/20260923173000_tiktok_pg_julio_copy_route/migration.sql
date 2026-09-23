-- TikTok Instant Form created as a copy; pin it to Educación EP.
-- Keep the exact decimal form ID as text (never a JavaScript number).
INSERT INTO "tiktok_lead_form_routes"
  ("form_id", "area", "form_name", "area_locked", "updated_at")
VALUES
  (
    '766792340623687943',
    'educacion_ep',
    '[FORM EP] - Cursos de PGC-JULIO Copia',
    true,
    CURRENT_TIMESTAMP
  )
ON CONFLICT ("form_id") DO UPDATE
SET
  "area" = EXCLUDED."area",
  "form_name" = EXCLUDED."form_name",
  "area_locked" = true,
  "updated_at" = CURRENT_TIMESTAMP;
