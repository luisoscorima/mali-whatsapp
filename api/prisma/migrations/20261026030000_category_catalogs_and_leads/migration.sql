-- El mismo atributo o flujo puede existir en General, CA y EP.
ALTER TABLE contact_attribute_definitions DROP CONSTRAINT IF EXISTS idx_contact_attr_defs_area_slug;
ALTER TABLE contact_attribute_definitions DROP CONSTRAINT IF EXISTS idx_contact_attr_defs_area_seg_slug;
DROP INDEX IF EXISTS idx_contact_attr_defs_area_slug;
DROP INDEX IF EXISTS idx_contact_attr_defs_area_seg_slug;

ALTER TABLE flows DROP CONSTRAINT IF EXISTS flows_area_trigger_uq;
DROP INDEX IF EXISTS flows_area_trigger_uq;

UPDATE contact_attribute_definitions def
SET area = 'educacion',
    program_id = program.id,
    updated_at = NOW()
FROM business_programs program
JOIN business_areas area ON area.id = program.business_area_id AND area.slug = 'educacion'
WHERE def.program_id IS NULL
  AND (
    (def.area = 'educacion_ca' AND program.slug = 'ca')
    OR (def.area = 'educacion_ep' AND program.slug = 'ep')
  );

UPDATE flows flow
SET area = 'educacion',
    program_id = program.id,
    updated_at = NOW()
FROM business_programs program
JOIN business_areas area ON area.id = program.business_area_id AND area.slug = 'educacion'
WHERE flow.program_id IS NULL
  AND (
    (flow.area = 'educacion_ca' AND program.slug = 'ca')
    OR (flow.area = 'educacion_ep' AND program.slug = 'ep')
  );

CREATE UNIQUE INDEX contact_attr_defs_area_slug_general_uq
  ON contact_attribute_definitions (area, slug)
  WHERE program_id IS NULL;

CREATE UNIQUE INDEX contact_attr_defs_area_program_slug_uq
  ON contact_attribute_definitions (area, program_id, slug)
  WHERE program_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contact_attr_defs_program
  ON contact_attribute_definitions (program_id);

CREATE UNIQUE INDEX flows_area_trigger_general_uq
  ON flows (area, trigger_payload)
  WHERE program_id IS NULL;

CREATE UNIQUE INDEX flows_area_program_trigger_uq
  ON flows (area, program_id, trigger_payload)
  WHERE program_id IS NOT NULL;

-- Leads que nacieron en el área general pero pertenecen al formulario o a la línea.
UPDATE contact_origins origin
SET program_id = program.id,
    updated_at = NOW()
FROM meta_lead_form_routes route
JOIN business_programs program
  ON program.slug = route.program_key
JOIN business_areas area
  ON area.id = program.business_area_id AND area.slug = 'educacion'
WHERE origin.program_id IS NULL
  AND origin.channel = 'meta_lead_form'
  AND origin.source_key = route.form_id
  AND route.program_key IS NOT NULL;

UPDATE contact_origins origin
SET program_id = program.id,
    updated_at = NOW()
FROM tiktok_lead_form_routes route
JOIN business_programs program
  ON program.slug = route.program_key
JOIN business_areas area
  ON area.id = program.business_area_id AND area.slug = 'educacion'
WHERE origin.program_id IS NULL
  AND origin.channel = 'tiktok'
  AND origin.source_key = route.form_id
  AND route.program_key IS NOT NULL;

UPDATE contact_origins origin
SET program_id = line.program_id,
    updated_at = NOW()
FROM conversations conv
JOIN whatsapp_lines line ON line.id = conv.whatsapp_line_id
WHERE origin.conversation_id = conv.id
  AND origin.program_id IS NULL
  AND line.program_id IS NOT NULL;

UPDATE education_lead_entries entry
SET program_id = origin.program_id
FROM contact_origins origin
WHERE entry.origin_id = origin.id
  AND entry.program_id IS NULL
  AND origin.program_id IS NOT NULL;

UPDATE education_lead_cycles cycle
SET program_id = picked.program_id,
    updated_at = NOW()
FROM (
  SELECT DISTINCT ON (entry.cycle_id) entry.cycle_id, origin.program_id
  FROM education_lead_entries entry
  JOIN contact_origins origin ON origin.id = entry.origin_id
  WHERE entry.cycle_id IS NOT NULL
    AND origin.program_id IS NOT NULL
  ORDER BY entry.cycle_id, entry.occurred_at DESC
) picked
WHERE cycle.id = picked.cycle_id
  AND cycle.program_id IS NULL;
