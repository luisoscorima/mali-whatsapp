ALTER TABLE "conversations" ALTER COLUMN "phone" TYPE VARCHAR(132);
ALTER TABLE "contacts" ADD COLUMN "whatsapp_user_id" VARCHAR(132);
CREATE UNIQUE INDEX "contacts_area_whatsapp_user_id_key" ON "contacts"("area", "whatsapp_user_id");
ALTER TABLE "conversations" ADD COLUMN "whatsapp_user_id" VARCHAR(132);
ALTER TABLE "conversations" ADD COLUMN "wa_username" VARCHAR(100);
CREATE UNIQUE INDEX "conversations_area_whatsapp_user_id_key" ON "conversations"("area", "whatsapp_user_id");
ALTER TABLE "campaign_logs" ALTER COLUMN "phone" TYPE VARCHAR(132);
ALTER TABLE "meta_ctwa_ad_leads" ALTER COLUMN "phone" TYPE VARCHAR(132);
