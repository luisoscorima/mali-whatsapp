-- Email + opt-in for dual-channel CRM (WhatsApp + mailing via MALI ONE)
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "email" VARCHAR(255);
ALTER TABLE "contacts" ADD COLUMN IF NOT EXISTS "opt_in_email" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "idx_contacts_area_email" ON "contacts" ("area", "email");
