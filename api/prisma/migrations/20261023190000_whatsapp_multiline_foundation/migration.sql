-- Foundation for dynamic business areas and multiple WhatsApp lines.
-- This migration is additive: existing area strings and runtime routing remain untouched.

CREATE TABLE "business_areas" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(40) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_areas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "business_area_aliases" (
    "alias" VARCHAR(40) NOT NULL,
    "business_area_id" INTEGER NOT NULL,
    "program_key" VARCHAR(40),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "business_area_aliases_pkey" PRIMARY KEY ("alias")
);

CREATE TABLE "meta_credentials" (
    "id" SERIAL NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "secret_source" VARCHAR(24) NOT NULL DEFAULT 'env',
    "secret_ref" VARCHAR(255),
    "encrypted_token" TEXT,
    "token_fingerprint" VARCHAR(64),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "validation_status" VARCHAR(24) NOT NULL DEFAULT 'unknown',
    "validation_error" TEXT,
    "last_validated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_credentials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_wabas" (
    "id" SERIAL NOT NULL,
    "meta_waba_id" VARCHAR(32) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "default_credential_id" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "app_subscription_status" VARCHAR(24) NOT NULL DEFAULT 'unknown',
    "last_validated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_wabas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_lines" (
    "id" SERIAL NOT NULL,
    "business_area_id" INTEGER NOT NULL,
    "waba_id" INTEGER NOT NULL,
    "credential_override_id" INTEGER,
    "phone_number_id" VARCHAR(32) NOT NULL,
    "display_phone_number" VARCHAR(32),
    "label" VARCHAR(120) NOT NULL,
    "legacy_area" VARCHAR(40),
    "program_key" VARCHAR(40),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "registration_status" VARCHAR(24) NOT NULL DEFAULT 'unknown',
    "quality_rating" VARCHAR(24),
    "last_validated_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_areas_slug_key" ON "business_areas"("slug");
CREATE INDEX "idx_business_area_aliases_area" ON "business_area_aliases"("business_area_id");
CREATE UNIQUE INDEX "whatsapp_wabas_meta_waba_id_key" ON "whatsapp_wabas"("meta_waba_id");
CREATE INDEX "idx_whatsapp_wabas_default_credential" ON "whatsapp_wabas"("default_credential_id");
CREATE UNIQUE INDEX "whatsapp_lines_phone_number_id_key" ON "whatsapp_lines"("phone_number_id");
CREATE INDEX "idx_whatsapp_lines_business_area" ON "whatsapp_lines"("business_area_id");
CREATE INDEX "idx_whatsapp_lines_waba" ON "whatsapp_lines"("waba_id");
CREATE INDEX "idx_whatsapp_lines_credential_override" ON "whatsapp_lines"("credential_override_id");
CREATE INDEX "idx_whatsapp_lines_legacy_area" ON "whatsapp_lines"("legacy_area");

-- Only one active default sending line is allowed per canonical business area.
CREATE UNIQUE INDEX "whatsapp_lines_one_active_default_per_area_uq"
    ON "whatsapp_lines"("business_area_id")
    WHERE "is_default" = true AND "active" = true;

ALTER TABLE "business_area_aliases"
    ADD CONSTRAINT "business_area_aliases_business_area_id_fkey"
    FOREIGN KEY ("business_area_id") REFERENCES "business_areas"("id")
    ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "whatsapp_wabas"
    ADD CONSTRAINT "whatsapp_wabas_default_credential_id_fkey"
    FOREIGN KEY ("default_credential_id") REFERENCES "meta_credentials"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "whatsapp_lines"
    ADD CONSTRAINT "whatsapp_lines_business_area_id_fkey"
    FOREIGN KEY ("business_area_id") REFERENCES "business_areas"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "whatsapp_lines"
    ADD CONSTRAINT "whatsapp_lines_waba_id_fkey"
    FOREIGN KEY ("waba_id") REFERENCES "whatsapp_wabas"("id")
    ON DELETE RESTRICT ON UPDATE NO ACTION;

ALTER TABLE "whatsapp_lines"
    ADD CONSTRAINT "whatsapp_lines_credential_override_id_fkey"
    FOREIGN KEY ("credential_override_id") REFERENCES "meta_credentials"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "campaigns" ADD COLUMN "whatsapp_line_id" INTEGER;
CREATE INDEX "idx_campaigns_whatsapp_line" ON "campaigns"("whatsapp_line_id");
ALTER TABLE "campaigns"
    ADD CONSTRAINT "campaigns_whatsapp_line_id_fkey"
    FOREIGN KEY ("whatsapp_line_id") REFERENCES "whatsapp_lines"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "conversations" ADD COLUMN "whatsapp_line_id" INTEGER;
CREATE INDEX "idx_conversations_whatsapp_line" ON "conversations"("whatsapp_line_id");
ALTER TABLE "conversations"
    ADD CONSTRAINT "conversations_whatsapp_line_id_fkey"
    FOREIGN KEY ("whatsapp_line_id") REFERENCES "whatsapp_lines"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "whatsapp_templates" ADD COLUMN "whatsapp_waba_id" INTEGER;
CREATE INDEX "idx_whatsapp_templates_waba" ON "whatsapp_templates"("whatsapp_waba_id");
ALTER TABLE "whatsapp_templates"
    ADD CONSTRAINT "whatsapp_templates_whatsapp_waba_id_fkey"
    FOREIGN KEY ("whatsapp_waba_id") REFERENCES "whatsapp_wabas"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;

-- Canonical tenants and compatibility aliases. CA/EP become Education programs.
INSERT INTO "business_areas" ("slug", "label", "sort_order") VALUES
    ('ti', 'Tecnología de la Información', 10),
    ('pam', 'PAM', 20),
    ('patronato', 'Patronato', 30),
    ('educacion', 'Educación', 40)
ON CONFLICT ("slug") DO NOTHING;

INSERT INTO "business_area_aliases" ("alias", "business_area_id", "program_key")
SELECT source.alias, area.id, source.program_key
FROM (
    VALUES
        ('ti', 'ti', NULL::VARCHAR(40)),
        ('pam', 'pam', NULL::VARCHAR(40)),
        ('patronato', 'patronato', NULL::VARCHAR(40)),
        ('educacion', 'educacion', NULL::VARCHAR(40)),
        ('educacion_ca', 'educacion', 'ca'::VARCHAR(40)),
        ('educacion_ep', 'educacion', 'ep'::VARCHAR(40))
) AS source(alias, canonical_slug, program_key)
JOIN "business_areas" area ON area.slug = source.canonical_slug
ON CONFLICT ("alias") DO NOTHING;
