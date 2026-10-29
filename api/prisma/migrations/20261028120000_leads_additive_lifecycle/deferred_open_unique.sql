-- Apply ONLY after education_lead_open_conflicts is empty (manual review done).
-- This file creates the unique indexes that enforce one open lead per person/category.
--
-- Preconditions:
--   SELECT COUNT(*) FROM education_lead_open_conflicts WHERE resolved_at IS NULL;
-- must be 0. Resolve conflicts with explicit close_reason before running.
--
-- Then:
--   psql "$DATABASE_URL" -f deferred_open_unique.sql

CREATE UNIQUE INDEX IF NOT EXISTS "education_lead_cycles_open_person_program_uq"
  ON "education_lead_cycles" ("person_id", "business_area_id", "program_id")
  WHERE "closed_at" IS NULL AND "program_id" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "education_lead_cycles_open_person_general_uq"
  ON "education_lead_cycles" ("person_id", "business_area_id")
  WHERE "closed_at" IS NULL AND "program_id" IS NULL;
