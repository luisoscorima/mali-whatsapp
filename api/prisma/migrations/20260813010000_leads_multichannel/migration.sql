-- Leads multicanal: identidad flexible, estados, orígenes, Instant Forms

-- 1) contacts: phone nullable + uniques parciales
ALTER TABLE "contacts" ALTER COLUMN "phone" DROP NOT NULL;

ALTER TABLE "contacts" DROP CONSTRAINT IF EXISTS "contacts_area_phone_key";

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_area_phone_uq"
  ON "contacts" ("area", "phone")
  WHERE "phone" IS NOT NULL AND "phone" <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_area_dni_uq"
  ON "contacts" ("area", "dni")
  WHERE "dni" IS NOT NULL AND "dni" <> '';

CREATE UNIQUE INDEX IF NOT EXISTS "contacts_area_email_uq"
  ON "contacts" ("area", "email")
  WHERE "email" IS NOT NULL AND "email" <> '';

-- 2) lead_status_definitions
CREATE TABLE IF NOT EXISTS "lead_status_definitions" (
  "id" SERIAL PRIMARY KEY,
  "area" VARCHAR(20) NOT NULL,
  "slug" VARCHAR(50) NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "sort_order" INTEGER NOT NULL DEFAULT 0,
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "is_terminal" BOOLEAN NOT NULL DEFAULT false,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "lead_status_definitions_area_slug_key"
  ON "lead_status_definitions" ("area", "slug");

CREATE INDEX IF NOT EXISTS "idx_lead_status_definitions_area"
  ON "lead_status_definitions" ("area");

-- Seed default statuses per known area
INSERT INTO "lead_status_definitions" ("area", "slug", "label", "sort_order", "is_default", "is_terminal")
SELECT a.area, s.slug, s.label, s.sort_order, s.is_default, s.is_terminal
FROM (VALUES
  ('ti'), ('pam'), ('patronato'), ('educacion'), ('educacion_ca'), ('educacion_ep')
) AS a(area)
CROSS JOIN (VALUES
  ('nuevo', 'Nuevo', 0, true, false),
  ('contactado', 'Contactado', 10, false, false),
  ('calificado', 'Calificado', 20, false, false),
  ('convertido', 'Convertido', 30, false, true),
  ('perdido', 'Perdido', 40, false, true)
) AS s(slug, label, sort_order, is_default, is_terminal)
ON CONFLICT ("area", "slug") DO NOTHING;

-- 3) contacts.lead_status_id
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "lead_status_id" INTEGER;
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "lead_status_updated_at" TIMESTAMPTZ(6);

UPDATE "contacts" c
SET "lead_status_id" = d.id,
    "lead_status_updated_at" = NOW()
FROM "lead_status_definitions" d
WHERE d.area = c.area AND d.is_default = true AND c.lead_status_id IS NULL;

ALTER TABLE "contacts"
  DROP CONSTRAINT IF EXISTS "contacts_lead_status_id_fkey";

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_lead_status_id_fkey"
  FOREIGN KEY ("lead_status_id") REFERENCES "lead_status_definitions"("id")
  ON UPDATE NO ACTION ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "idx_contacts_lead_status"
  ON "contacts" ("lead_status_id");

-- 4) contact_origins
CREATE TABLE IF NOT EXISTS "contact_origins" (
  "id" SERIAL PRIMARY KEY,
  "area" VARCHAR(32) NOT NULL,
  "contact_id" INTEGER,
  "channel" VARCHAR(32) NOT NULL,
  "external_id" VARCHAR(128) NOT NULL,
  "source_key" VARCHAR(128),
  "source_label" VARCHAR(200),
  "payload" JSONB,
  "phone" VARCHAR(32),
  "dni" VARCHAR(32),
  "email" VARCHAR(255),
  "conversation_id" INTEGER,
  "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "contact_origins_area_channel_external_uq"
  ON "contact_origins" ("area", "channel", "external_id");

CREATE INDEX IF NOT EXISTS "idx_contact_origins_contact"
  ON "contact_origins" ("contact_id");

CREATE INDEX IF NOT EXISTS "idx_contact_origins_area_channel"
  ON "contact_origins" ("area", "channel");

ALTER TABLE "contact_origins"
  DROP CONSTRAINT IF EXISTS "contact_origins_contact_id_fkey";
ALTER TABLE "contact_origins"
  ADD CONSTRAINT "contact_origins_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "contact_origins"
  DROP CONSTRAINT IF EXISTS "contact_origins_conversation_id_fkey";
ALTER TABLE "contact_origins"
  ADD CONSTRAINT "contact_origins_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

-- 5) Instant Forms tables
CREATE TABLE IF NOT EXISTS "meta_lead_forms" (
  "id" SERIAL PRIMARY KEY,
  "area" VARCHAR(32) NOT NULL,
  "form_id" VARCHAR(64) NOT NULL,
  "name" VARCHAR(200),
  "page_id" VARCHAR(64),
  "lead_count" INTEGER NOT NULL DEFAULT 0,
  "last_sync_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "meta_lead_forms_area_form_uq"
  ON "meta_lead_forms" ("area", "form_id");

CREATE INDEX IF NOT EXISTS "idx_meta_lead_forms_area"
  ON "meta_lead_forms" ("area");

CREATE TABLE IF NOT EXISTS "meta_leadgen_leads" (
  "id" SERIAL PRIMARY KEY,
  "area" VARCHAR(32) NOT NULL,
  "leadgen_id" VARCHAR(64) NOT NULL,
  "form_id" VARCHAR(64) NOT NULL,
  "page_id" VARCHAR(64),
  "ad_id" VARCHAR(64),
  "adgroup_id" VARCHAR(64),
  "field_data" JSONB,
  "raw" JSONB,
  "contact_id" INTEGER,
  "contact_origin_id" INTEGER,
  "created_time" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS "meta_leadgen_leads_leadgen_uq"
  ON "meta_leadgen_leads" ("leadgen_id");

CREATE INDEX IF NOT EXISTS "idx_meta_leadgen_leads_area_form"
  ON "meta_leadgen_leads" ("area", "form_id");

CREATE INDEX IF NOT EXISTS "idx_meta_leadgen_leads_contact"
  ON "meta_leadgen_leads" ("contact_id");

ALTER TABLE "meta_leadgen_leads"
  DROP CONSTRAINT IF EXISTS "meta_leadgen_leads_contact_id_fkey";
ALTER TABLE "meta_leadgen_leads"
  ADD CONSTRAINT "meta_leadgen_leads_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "meta_leadgen_leads"
  DROP CONSTRAINT IF EXISTS "meta_leadgen_leads_contact_origin_id_fkey";
ALTER TABLE "meta_leadgen_leads"
  ADD CONSTRAINT "meta_leadgen_leads_contact_origin_id_fkey"
  FOREIGN KEY ("contact_origin_id") REFERENCES "contact_origins"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
