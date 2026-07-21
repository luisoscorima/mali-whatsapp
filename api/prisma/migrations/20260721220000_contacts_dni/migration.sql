-- DNI nativo opcional en contacts (PAM / CRM)
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "dni" VARCHAR(32);

-- Backfill desde atributos históricos
UPDATE "contacts" c
SET "dni" = LEFT(TRIM(ca.attr_value), 32)
FROM "contact_attributes" ca
WHERE ca.contact_id = c.id
  AND ca.attr_key = 'dni'
  AND TRIM(ca.attr_value) <> ''
  AND (c.dni IS NULL OR TRIM(c.dni) = '');

CREATE INDEX IF NOT EXISTS "idx_contacts_area_dni" ON "contacts" ("area", "dni");
