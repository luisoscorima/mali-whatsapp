-- Educación: estado y calificación del lead viven en education_lead_cycles, no en contacts.
-- Se anulan espejos legados para que no se lean por error en reportes/UI.
UPDATE contacts
SET lead_status_id = NULL,
    lead_status_updated_at = NULL,
    lead_score = NULL,
    updated_at = NOW()
WHERE area IN ('educacion', 'educacion_ca', 'educacion_ep')
  AND (
    lead_status_id IS NOT NULL
    OR lead_status_updated_at IS NOT NULL
    OR lead_score IS NOT NULL
  );
