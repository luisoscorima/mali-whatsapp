-- Additive lifecycle for education lead cycles (piloto Educación).
-- Does not drop legacy columns. Does NOT auto-resolve open duplicates
-- nor invent attention timestamps without evidence.
-- Unique open indexes: see deferred_open_unique.sql after manual review.

ALTER TABLE "education_lead_cycles"
  ADD COLUMN IF NOT EXISTS "person_id" INTEGER,
  ADD COLUMN IF NOT EXISTS "closed_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "close_reason" VARCHAR(40),
  ADD COLUMN IF NOT EXISTS "first_assigned_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "first_human_reply_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "first_inbound_at" TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "inactivity_deadline_at" TIMESTAMPTZ(6);

UPDATE "education_lead_cycles" c
SET "person_id" = ct.person_id
FROM "contacts" ct
WHERE c.contact_id = ct.id
  AND c.person_id IS NULL;

-- Close cycles already in a terminal status (evidence-based).
UPDATE "education_lead_cycles" c
SET
  "closed_at" = COALESCE(c.closed_at, c.updated_at, c.last_interaction_at, c.started_at),
  "close_reason" = COALESCE(c.close_reason, 'terminal_status')
FROM "lead_status_definitions" s
WHERE s.id = c.lead_status_id
  AND s.is_terminal = TRUE
  AND c.closed_at IS NULL;

-- Do NOT backfill inactivity_deadline_at on historical open cycles.
-- Auto-expire (expireDueCycles) only closes rows with a deadline set by the
-- post-activation writers. Pre-existing opens stay candidates for a separate
-- reviewable batch (see leads-expire-historical-candidates.cjs).

-- Conflict report for manual review (no silent close of competing open cycles).
CREATE TABLE IF NOT EXISTS "education_lead_open_conflicts" (
  "id" SERIAL PRIMARY KEY,
  "person_id" INTEGER NOT NULL,
  "business_area_id" INTEGER NOT NULL,
  "program_id" INTEGER,
  "cycle_ids" INTEGER[] NOT NULL,
  "cycle_count" INTEGER NOT NULL,
  "detected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "resolved_at" TIMESTAMPTZ(6)
);

DELETE FROM "education_lead_open_conflicts" WHERE resolved_at IS NULL;

INSERT INTO "education_lead_open_conflicts" (
  person_id, business_area_id, program_id, cycle_ids, cycle_count
)
SELECT
  person_id,
  business_area_id,
  program_id,
  array_agg(id ORDER BY started_at DESC, id DESC),
  COUNT(*)::int
FROM "education_lead_cycles"
WHERE closed_at IS NULL
  AND person_id IS NOT NULL
GROUP BY person_id, business_area_id, program_id
HAVING COUNT(*) > 1;

-- person_id NOT NULL only when every row is backfilled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "education_lead_cycles" WHERE person_id IS NULL
  ) THEN
    ALTER TABLE "education_lead_cycles" ALTER COLUMN "person_id" SET NOT NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'education_lead_cycles_person_id_fkey'
  ) THEN
    ALTER TABLE "education_lead_cycles"
      ADD CONSTRAINT "education_lead_cycles_person_id_fkey"
      FOREIGN KEY ("person_id") REFERENCES "people"("id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "education_lead_cycles_person_started_idx"
  ON "education_lead_cycles" ("person_id", "started_at" DESC);

CREATE INDEX IF NOT EXISTS "education_lead_cycles_open_person_idx"
  ON "education_lead_cycles" ("person_id", "business_area_id", "program_id")
  WHERE "closed_at" IS NULL;

CREATE TABLE IF NOT EXISTS "education_lead_conversation_links" (
  "id" SERIAL PRIMARY KEY,
  "cycle_id" INTEGER NOT NULL,
  "conversation_id" INTEGER NOT NULL,
  "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "unlinked_at" TIMESTAMPTZ(6),
  CONSTRAINT "education_lead_conversation_links_cycle_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "education_lead_cycles"("id") ON DELETE CASCADE,
  CONSTRAINT "education_lead_conversation_links_conversation_fkey"
    FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS "education_lead_conv_links_cycle_idx"
  ON "education_lead_conversation_links" ("cycle_id", "linked_at" DESC);

CREATE INDEX IF NOT EXISTS "education_lead_conv_links_conversation_idx"
  ON "education_lead_conversation_links" ("conversation_id", "linked_at" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "education_lead_conv_links_open_uq"
  ON "education_lead_conversation_links" ("cycle_id", "conversation_id")
  WHERE "unlinked_at" IS NULL;

CREATE TABLE IF NOT EXISTS "education_lead_alerts" (
  "id" SERIAL PRIMARY KEY,
  "cycle_id" INTEGER NOT NULL,
  "business_area_id" INTEGER NOT NULL,
  "program_id" INTEGER,
  "area" VARCHAR(20) NOT NULL,
  "event_type" VARCHAR(40) NOT NULL DEFAULT 'new_lead',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "education_lead_alerts_cycle_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "education_lead_cycles"("id") ON DELETE CASCADE,
  CONSTRAINT "education_lead_alerts_area_fkey"
    FOREIGN KEY ("business_area_id") REFERENCES "business_areas"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "education_lead_alerts_cycle_type_uq"
  ON "education_lead_alerts" ("cycle_id", "event_type");

CREATE INDEX IF NOT EXISTS "education_lead_alerts_area_created_idx"
  ON "education_lead_alerts" ("area", "created_at" DESC);

CREATE TABLE IF NOT EXISTS "education_lead_alert_reads" (
  "id" SERIAL PRIMARY KEY,
  "alert_id" INTEGER NOT NULL,
  "user_id" INTEGER NOT NULL,
  "read_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "education_lead_alert_reads_alert_fkey"
    FOREIGN KEY ("alert_id") REFERENCES "education_lead_alerts"("id") ON DELETE CASCADE,
  CONSTRAINT "education_lead_alert_reads_user_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "education_lead_alert_reads_uq"
  ON "education_lead_alert_reads" ("alert_id", "user_id");

ALTER TABLE "contact_attribute_definitions"
  ADD COLUMN IF NOT EXISTS "owner_kind" VARCHAR(16) NOT NULL DEFAULT 'contact',
  ADD COLUMN IF NOT EXISTS "shared_scope" VARCHAR(16) NOT NULL DEFAULT 'contextual';

CREATE TABLE IF NOT EXISTS "education_lead_attributes" (
  "id" SERIAL PRIMARY KEY,
  "cycle_id" INTEGER NOT NULL,
  "definition_id" INTEGER NOT NULL,
  "attr_key" VARCHAR(64) NOT NULL,
  "attr_value" TEXT NOT NULL DEFAULT '',
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT "education_lead_attributes_cycle_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "education_lead_cycles"("id") ON DELETE CASCADE,
  CONSTRAINT "education_lead_attributes_definition_fkey"
    FOREIGN KEY ("definition_id") REFERENCES "contact_attribute_definitions"("id") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS "education_lead_attributes_cycle_def_uq"
  ON "education_lead_attributes" ("cycle_id", "definition_id");

CREATE INDEX IF NOT EXISTS "education_lead_attributes_cycle_idx"
  ON "education_lead_attributes" ("cycle_id");
