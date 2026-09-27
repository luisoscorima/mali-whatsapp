ALTER TABLE "education_lead_entries"
  ADD COLUMN "prospectia_match" VARCHAR(16),
  ADD COLUMN "prospectia_advisor_email" VARCHAR(255),
  ADD COLUMN "prospectia_checked_at" TIMESTAMPTZ(6);

ALTER TABLE "contacts"
  DROP COLUMN IF EXISTS "prospectia_match",
  DROP COLUMN IF EXISTS "prospectia_advisor_email",
  DROP COLUMN IF EXISTS "prospectia_checked_at";
