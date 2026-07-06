-- Legacy no tenía apellido separado; v2 lo usa en contactos, dashboard e import.
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "last_name" VARCHAR(150) NOT NULL DEFAULT '';
