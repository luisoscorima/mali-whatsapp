-- AlterTable
ALTER TABLE "education_lead_cycles" ADD COLUMN IF NOT EXISTS "promise_at" TIMESTAMPTZ(6);
ALTER TABLE "education_lead_cycles" ADD COLUMN IF NOT EXISTS "lost_reason" VARCHAR(64);
