-- Depreca educacion_ca / educacion_ep como áreas del catálogo.
-- La categoría queda en program_id / program_key. No borra filas residuales;
-- correr antes api/scripts/relabel-education-aliases.cjs --apply.
UPDATE business_area_aliases
SET active = false
WHERE alias IN ('educacion_ca', 'educacion_ep');
