ALTER TABLE "contact_origins"
  ADD COLUMN "whatsapp_user_id" VARCHAR(132);

CREATE INDEX "idx_contact_origins_area_whatsapp_user_id"
  ON "contact_origins" ("area", "whatsapp_user_id");

UPDATE "contact_origins" origin
SET "whatsapp_user_id" = conversation."whatsapp_user_id"
FROM "conversations" conversation
WHERE conversation."id" = origin."conversation_id"
  AND origin."whatsapp_user_id" IS NULL;
