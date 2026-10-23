-- Programs live inside a canonical business area and are independent from Meta lines.
CREATE TABLE "business_programs" (
    "id" SERIAL NOT NULL,
    "business_area_id" INTEGER NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_programs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_programs_area_slug_uq"
    ON "business_programs"("business_area_id", "slug");
CREATE INDEX "idx_business_programs_area"
    ON "business_programs"("business_area_id");

ALTER TABLE "business_programs"
    ADD CONSTRAINT "business_programs_business_area_id_fkey"
    FOREIGN KEY ("business_area_id") REFERENCES "business_areas"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

-- A person may participate in CA, EP, both, or neither.
CREATE TABLE "contact_programs" (
    "contact_id" INTEGER NOT NULL,
    "program_id" INTEGER NOT NULL,
    "source" VARCHAR(32) NOT NULL DEFAULT 'migration',
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_programs_pkey" PRIMARY KEY ("contact_id", "program_id")
);

CREATE INDEX "idx_contact_programs_program" ON "contact_programs"("program_id");

ALTER TABLE "contact_programs"
    ADD CONSTRAINT "contact_programs_contact_id_fkey"
    FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "contact_programs"
    ADD CONSTRAINT "contact_programs_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "business_programs"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "whatsapp_lines" ADD COLUMN "program_id" INTEGER;
CREATE INDEX "idx_whatsapp_lines_program" ON "whatsapp_lines"("program_id");
ALTER TABLE "whatsapp_lines"
    ADD CONSTRAINT "whatsapp_lines_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "business_programs"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

INSERT INTO "business_programs" (
    "business_area_id", "slug", "label", "sort_order"
)
SELECT area.id, seed.slug, seed.label, seed.sort_order
FROM "business_areas" area
CROSS JOIN (
    VALUES
        ('ca'::VARCHAR(40), 'Educación CA'::VARCHAR(120), 10),
        ('ep'::VARCHAR(40), 'Educación EP'::VARCHAR(120), 20)
) AS seed(slug, label, sort_order)
WHERE area.slug = 'educacion'
ON CONFLICT ("business_area_id", "slug") DO NOTHING;

UPDATE "whatsapp_lines" line
SET "program_id" = program.id
FROM "business_programs" program
WHERE program.business_area_id = line.business_area_id
  AND program.slug = line.program_key
  AND line.program_key IS NOT NULL;

-- Preserve current CA/EP affiliation before contacts are canonicalized.
INSERT INTO "contact_programs" (
    "contact_id", "program_id", "source", "first_seen_at", "last_seen_at"
)
SELECT
    contact.id,
    program.id,
    'legacy_area',
    contact.created_at,
    contact.updated_at
FROM "contacts" contact
JOIN "business_area_aliases" alias ON alias.alias = contact.area
JOIN "business_programs" program
  ON program.business_area_id = alias.business_area_id
 AND program.slug = alias.program_key
WHERE alias.program_key IS NOT NULL
ON CONFLICT ("contact_id", "program_id") DO NOTHING;

-- New identity keys coexist with the legacy area keys until the Education cutover.
-- PostgreSQL allows multiple NULLs, so pre-catalog legacy rows remain compatible.
CREATE UNIQUE INDEX "conversations_line_phone_uq"
    ON "conversations"("whatsapp_line_id", "phone");
CREATE UNIQUE INDEX "conversations_line_wuid_uq"
    ON "conversations"("whatsapp_line_id", "whatsapp_user_id");

-- Catalogued conversations may share area + recipient when they belong to
-- different WhatsApp lines. Keep the old uniqueness only for legacy rows that
-- have not been assigned to the catalog yet.
DROP INDEX "conversations_area_phone_key";
DROP INDEX "conversations_area_whatsapp_user_id_key";
CREATE INDEX "idx_conversations_area_phone"
    ON "conversations"("area", "phone");
CREATE INDEX "idx_conversations_area_wuid"
    ON "conversations"("area", "whatsapp_user_id");
CREATE UNIQUE INDEX "conversations_legacy_area_phone_uq"
    ON "conversations"("area", "phone")
    WHERE "whatsapp_line_id" IS NULL;
CREATE UNIQUE INDEX "conversations_legacy_area_wuid_uq"
    ON "conversations"("area", "whatsapp_user_id")
    WHERE "whatsapp_line_id" IS NULL;
