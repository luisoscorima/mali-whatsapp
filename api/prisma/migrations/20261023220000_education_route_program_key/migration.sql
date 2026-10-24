-- Optional program on lead form routes so CA/EP survive the move to area educacion.
ALTER TABLE "meta_lead_form_routes"
    ADD COLUMN IF NOT EXISTS "program_key" VARCHAR(40);

ALTER TABLE "tiktok_lead_form_routes"
    ADD COLUMN IF NOT EXISTS "program_key" VARCHAR(40);
