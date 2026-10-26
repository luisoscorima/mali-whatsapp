ALTER TABLE "segment_definitions"
  ADD COLUMN IF NOT EXISTS "program_id" INTEGER;

ALTER TABLE "flows"
  ADD COLUMN IF NOT EXISTS "program_id" INTEGER;

DO $$ BEGIN
  ALTER TABLE "segment_definitions"
    ADD CONSTRAINT "segment_definitions_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "business_programs"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "flows"
    ADD CONSTRAINT "flows_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "business_programs"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_segment_definitions_program"
  ON "segment_definitions"("program_id");

CREATE INDEX IF NOT EXISTS "idx_flows_program"
  ON "flows"("program_id");

ALTER TABLE "contact_segments"
  ADD COLUMN IF NOT EXISTS "program_id" INTEGER;

DO $$ BEGIN
  ALTER TABLE "contact_segments"
    ADD CONSTRAINT "contact_segments_program_id_fkey"
    FOREIGN KEY ("program_id") REFERENCES "business_programs"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "idx_contact_segments_program"
  ON "contact_segments"("program_id");

ALTER TABLE "segment_definitions"
  DROP CONSTRAINT IF EXISTS "segment_definitions_area_slug_key";

ALTER TABLE "contact_segments"
  DROP CONSTRAINT IF EXISTS "contact_segments_contact_id_segment_slug_key";

CREATE UNIQUE INDEX IF NOT EXISTS "segment_definitions_area_slug_general_uq"
  ON "segment_definitions" ("area", "slug")
  WHERE "program_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "segment_definitions_area_program_slug_uq"
  ON "segment_definitions" ("area", "program_id", "slug")
  WHERE "program_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "contact_segments_contact_slug_general_uq"
  ON "contact_segments" ("contact_id", "segment_slug")
  WHERE "program_id" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "contact_segments_contact_program_slug_uq"
  ON "contact_segments" ("contact_id", "program_id", "segment_slug")
  WHERE "program_id" IS NOT NULL;
