-- Educación: el estado del lead vive en education_lead_cycles, no en contacts.
-- Se anula el espejo legado para que no se lea por error en reportes/UI.
UPDATE contacts
SET lead_status_id = NULL,
    lead_status_updated_at = NULL,
    updated_at = NOW()
WHERE area IN ('educacion', 'educacion_ca', 'educacion_ep')
  AND (lead_status_id IS NOT NULL OR lead_status_updated_at IS NOT NULL);
