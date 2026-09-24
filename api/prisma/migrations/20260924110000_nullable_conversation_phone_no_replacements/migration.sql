-- Preserve legacy replacement links for audit, then retire replacement state.
CREATE TABLE "contact_replacement_history" (
  "old_contact_id" INTEGER PRIMARY KEY,
  "new_contact_id" INTEGER,
  "replaced_at" TIMESTAMPTZ,
  "reason" VARCHAR(64)
);

INSERT INTO "contact_replacement_history" ("old_contact_id", "new_contact_id", "replaced_at", "reason")
SELECT "id", "replaced_by_contact_id", "replaced_at", "replacement_reason"
FROM "contacts"
WHERE "replaced_by_contact_id" IS NOT NULL OR "replaced_at" IS NOT NULL OR "replacement_reason" IS NOT NULL;

ALTER TABLE "contacts"
  DROP COLUMN "replaced_by_contact_id",
  DROP COLUMN "replaced_at",
  DROP COLUMN "replacement_reason";

-- A BSUID is an identity, never a phone number.
-- Previous campaign sends could create a BSUID-keyed conversation alongside a
-- phone-keyed conversation already holding the same whatsapp_user_id.
CREATE TEMP TABLE bsuid_conversation_duplicates AS
SELECT legacy.id AS old_id, current_conv.id AS target_id
FROM "conversations" legacy
JOIN "conversations" current_conv
  ON current_conv.area = legacy.area
 AND current_conv.whatsapp_user_id = legacy.phone
 AND current_conv.id <> legacy.id
WHERE legacy.phone ~ '^[A-Z]{2}\.[A-Za-z0-9]{1,128}$';

UPDATE "conversations" target
SET last_message_at = GREATEST(target.last_message_at, old.last_message_at),
    last_user_message_at = GREATEST(target.last_user_message_at, old.last_user_message_at),
    inbox_unread = target.inbox_unread OR old.inbox_unread,
    archived = target.archived AND old.archived,
    contact_id = COALESCE(target.contact_id, old.contact_id),
    wa_profile_name = COALESCE(target.wa_profile_name, old.wa_profile_name),
    wa_username = COALESCE(target.wa_username, old.wa_username),
    whatsapp_phone_number_id = COALESCE(target.whatsapp_phone_number_id, old.whatsapp_phone_number_id)
FROM bsuid_conversation_duplicates map
JOIN "conversations" old ON old.id = map.old_id
WHERE target.id = map.target_id;

UPDATE "chat_messages" m SET conversation_id = map.target_id
FROM bsuid_conversation_duplicates map WHERE m.conversation_id = map.old_id;
INSERT INTO "conversation_tags" (conversation_id, label, source, meta_source_id, created_at)
SELECT map.target_id, tag.label, tag.source, tag.meta_source_id, tag.created_at
FROM "conversation_tags" tag
JOIN bsuid_conversation_duplicates map ON map.old_id = tag.conversation_id
ON CONFLICT (conversation_id, label) DO NOTHING;
UPDATE "flow_sessions" s SET conversation_id = map.target_id
FROM bsuid_conversation_duplicates map WHERE s.conversation_id = map.old_id;
UPDATE "flow_session_events" e SET conversation_id = map.target_id
FROM bsuid_conversation_duplicates map WHERE e.conversation_id = map.old_id;
UPDATE "contact_origins" o SET conversation_id = map.target_id
FROM bsuid_conversation_duplicates map WHERE o.conversation_id = map.old_id;
DELETE FROM "meta_ctwa_ad_leads" lead
USING bsuid_conversation_duplicates map
WHERE lead.conversation_id = map.old_id
  AND EXISTS (
    SELECT 1 FROM "meta_ctwa_ad_leads" kept
    WHERE kept.area = lead.area AND kept.meta_ctwa_ad_id = lead.meta_ctwa_ad_id
      AND kept.conversation_id = map.target_id
  );
UPDATE "meta_ctwa_ad_leads" lead SET conversation_id = map.target_id
FROM bsuid_conversation_duplicates map WHERE lead.conversation_id = map.old_id;
DELETE FROM "conversations" old
USING bsuid_conversation_duplicates map WHERE old.id = map.old_id;
DROP TABLE bsuid_conversation_duplicates;

ALTER TABLE "conversations" ALTER COLUMN "phone" DROP NOT NULL;

UPDATE "conversations"
SET "whatsapp_user_id" = COALESCE("whatsapp_user_id", "phone"), "phone" = NULL
WHERE "phone" ~ '^[A-Z]{2}\.[A-Za-z0-9]{1,128}$';

-- Keep Meta's identity-change notices for review without merging histories or mutating phones.
CREATE TABLE "whatsapp_identity_events" (
  "id" SERIAL PRIMARY KEY,
  "area" VARCHAR(20) NOT NULL,
  "wa_message_id" VARCHAR(180),
  "event_type" VARCHAR(64) NOT NULL,
  "previous_user_id" VARCHAR(132),
  "new_user_id" VARCHAR(132),
  "raw_payload" JSONB NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX "whatsapp_identity_events_area_wa_message_id_key"
  ON "whatsapp_identity_events" ("area", "wa_message_id");
CREATE INDEX "whatsapp_identity_events_area_created_at_idx"
  ON "whatsapp_identity_events" ("area", "created_at" DESC);

ALTER TABLE "meta_ctwa_ad_leads" ADD COLUMN "whatsapp_user_id" VARCHAR(132);
ALTER TABLE "meta_ctwa_ad_leads" ALTER COLUMN "phone" DROP NOT NULL;
UPDATE "meta_ctwa_ad_leads"
SET "whatsapp_user_id" = "phone", "phone" = NULL
WHERE "phone" ~ '^[A-Z]{2}\.[A-Za-z0-9]{1,128}$';
