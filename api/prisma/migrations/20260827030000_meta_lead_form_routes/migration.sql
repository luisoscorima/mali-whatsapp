-- Instant Form form_id → área Mali (CA / EP / Educación)
CREATE TABLE "meta_lead_form_routes" (
    "id" SERIAL NOT NULL,
    "form_id" VARCHAR(64) NOT NULL,
    "area" VARCHAR(32) NOT NULL,
    "form_name" VARCHAR(200),
    "page_id" VARCHAR(64),
    "area_locked" BOOLEAN NOT NULL DEFAULT false,
    "last_synced_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_lead_form_routes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meta_lead_form_routes_form_uq" ON "meta_lead_form_routes"("form_id");
CREATE INDEX "idx_meta_lead_form_routes_area" ON "meta_lead_form_routes"("area");

-- Seeds desde Google Sheets (forms conocidos)
INSERT INTO "meta_lead_form_routes" ("form_id", "area", "form_name", "area_locked", "updated_at")
VALUES
  (
    '1678089499945954',
    'educacion_ca',
    'Cursos de Arte - Artes Vocales - Jul 2026',
    false,
    CURRENT_TIMESTAMP
  ),
  (
    '1577538393930907',
    'educacion_ep',
    '[FORM EP] - Cursos libres-JUNIO',
    false,
    CURRENT_TIMESTAMP
  );
