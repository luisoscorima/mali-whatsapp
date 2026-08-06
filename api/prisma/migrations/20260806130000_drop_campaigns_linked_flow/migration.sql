-- Drop obsolete campaign ↔ flow metadata link (reference-only; unused by runtime).

ALTER TABLE "campaigns" DROP CONSTRAINT IF EXISTS "campaigns_linked_flow_id_fkey";
DROP INDEX IF EXISTS "idx_campaigns_linked_flow";
ALTER TABLE "campaigns" DROP COLUMN IF EXISTS "linked_flow_id";
