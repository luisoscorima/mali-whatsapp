-- TikTok Instant Form form_id (page_id) → área Mali
CREATE TABLE "tiktok_lead_form_routes" (
    "id" SERIAL NOT NULL,
    "form_id" VARCHAR(64) NOT NULL,
    "area" VARCHAR(32) NOT NULL,
    "form_name" VARCHAR(200),
    "advertiser_id" VARCHAR(64),
    "area_locked" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiktok_lead_form_routes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tiktok_lead_form_routes_form_uq" ON "tiktok_lead_form_routes"("form_id");
CREATE INDEX "idx_tiktok_lead_form_routes_area" ON "tiktok_lead_form_routes"("area");

CREATE TABLE "tiktok_leads" (
    "id" SERIAL NOT NULL,
    "area" VARCHAR(32) NOT NULL,
    "lead_id" VARCHAR(64) NOT NULL,
    "form_id" VARCHAR(64) NOT NULL,
    "advertiser_id" VARCHAR(64),
    "ad_id" VARCHAR(64),
    "field_data" JSONB,
    "raw" JSONB,
    "contact_id" INTEGER,
    "contact_origin_id" INTEGER,
    "created_time" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tiktok_leads_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tiktok_leads_lead_uq" ON "tiktok_leads"("lead_id");
CREATE INDEX "idx_tiktok_leads_area_form" ON "tiktok_leads"("area", "form_id");
CREATE INDEX "idx_tiktok_leads_contact" ON "tiktok_leads"("contact_id");

ALTER TABLE "tiktok_leads"
  ADD CONSTRAINT "tiktok_leads_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "tiktok_leads"
  ADD CONSTRAINT "tiktok_leads_contact_origin_id_fkey"
  FOREIGN KEY ("contact_origin_id") REFERENCES "contact_origins"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
