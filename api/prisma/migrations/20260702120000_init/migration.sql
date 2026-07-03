-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

CREATE EXTENSION IF NOT EXISTS "pg_trgm";
-- CreateTable
CREATE TABLE "app_settings" (
    "area" VARCHAR(20) NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("area","key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "level" VARCHAR(16) NOT NULL DEFAULT 'info',
    "event_type" VARCHAR(100) NOT NULL,
    "message" TEXT NOT NULL,
    "actor_user_id" INTEGER,
    "actor_email" VARCHAR(160),
    "area" VARCHAR(32),
    "client_ip" VARCHAR(128),
    "request_id" VARCHAR(64),
    "meta" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_logs" (
    "id" SERIAL NOT NULL,
    "campaign_id" INTEGER NOT NULL,
    "contact_id" INTEGER,
    "phone" VARCHAR(20) NOT NULL,
    "whatsapp_message_id" VARCHAR(150),
    "status" VARCHAR(30) NOT NULL,
    "response" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt" SMALLINT NOT NULL DEFAULT 1,
    "retryable" BOOLEAN NOT NULL DEFAULT true,
    "last_retry_at" TIMESTAMPTZ(6),

    CONSTRAINT "campaign_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" SERIAL NOT NULL,
    "area" VARCHAR(20) NOT NULL DEFAULT 'ti',
    "segment" TEXT NOT NULL,
    "template_name" VARCHAR(100) NOT NULL,
    "message_text" TEXT NOT NULL,
    "image_url" TEXT,
    "status" VARCHAR(30) NOT NULL DEFAULT 'queued',
    "total_recipients" INTEGER NOT NULL DEFAULT 0,
    "campaign_payload" JSONB,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduled_at" TIMESTAMPTZ(6),
    "auto_retry_at" TIMESTAMPTZ(6),
    "auto_retry_done" BOOLEAN NOT NULL DEFAULT false,
    "last_manual_retry_at" TIMESTAMPTZ(6),
    "manual_retry_count" INTEGER NOT NULL DEFAULT 0,
    "cost_amount" DECIMAL(14,4),
    "cost_currency" VARCHAR(8),
    "cost_synced_at" TIMESTAMPTZ(6),
    "cost_source" VARCHAR(40),
    "cost_is_estimated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "direction" VARCHAR(12) NOT NULL,
    "wa_message_id" VARCHAR(150),
    "body_text" TEXT,
    "message_type" VARCHAR(32) NOT NULL DEFAULT 'text',
    "raw_payload" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_ai" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_attribute_definitions" (
    "id" SERIAL NOT NULL,
    "area" VARCHAR(20) NOT NULL,
    "segment_slug" VARCHAR(50),
    "slug" VARCHAR(64) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "field_type" VARCHAR(16) NOT NULL DEFAULT 'text',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_attributes" (
    "id" SERIAL NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "attr_key" VARCHAR(64) NOT NULL,
    "attr_value" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_segments" (
    "id" SERIAL NOT NULL,
    "contact_id" INTEGER NOT NULL,
    "area" VARCHAR(20) NOT NULL,
    "segment_slug" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "last_name" VARCHAR(150) NOT NULL DEFAULT '',
    "phone" VARCHAR(20) NOT NULL,
    "segment" VARCHAR(50),
    "area" VARCHAR(20) NOT NULL DEFAULT 'ti',
    "opt_in" BOOLEAN NOT NULL DEFAULT true,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lead_score" SMALLINT,
    "replaced_by_contact_id" INTEGER,
    "replaced_at" TIMESTAMPTZ(6),
    "replacement_reason" VARCHAR(64),

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_tags" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "source" VARCHAR(32) NOT NULL DEFAULT 'manual',
    "meta_source_id" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" SERIAL NOT NULL,
    "area" VARCHAR(20) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "contact_id" INTEGER,
    "last_user_message_at" TIMESTAMPTZ(6),
    "last_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inbox_unread" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'bot',
    "attribution" JSONB,
    "meta_ctwa_ad_id" INTEGER,
    "whatsapp_phone_number_id" VARCHAR(32),
    "outside_hours_notice_sent_at" TIMESTAMPTZ(6),

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "email" VARCHAR(120) NOT NULL,
    "logged_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logged_out_at" TIMESTAMPTZ(6),
    "last_seen_at" TIMESTAMPTZ(6),

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_ctwa_ad_leads" (
    "id" SERIAL NOT NULL,
    "area" VARCHAR(32) NOT NULL,
    "meta_ctwa_ad_id" INTEGER NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "contact_id" INTEGER,
    "phone" VARCHAR(32) NOT NULL,
    "first_message_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ctwa_ad_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meta_ctwa_ads" (
    "id" SERIAL NOT NULL,
    "area" VARCHAR(32) NOT NULL,
    "meta_source_id" VARCHAR(128) NOT NULL,
    "display_name" VARCHAR(200),
    "ad_platform" VARCHAR(16) NOT NULL DEFAULT 'other',
    "source_url" TEXT,
    "source_type" VARCHAR(32),
    "headline" TEXT,
    "body" TEXT,
    "media_type" VARCHAR(32),
    "image_url" TEXT,
    "ctwa_clid" TEXT,
    "referral_snapshot" JSONB,
    "lead_count" INTEGER NOT NULL DEFAULT 0,
    "first_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meta_ctwa_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segment_definitions" (
    "id" SERIAL NOT NULL,
    "area" VARCHAR(20) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "color_key" VARCHAR(16) NOT NULL DEFAULT 'teal',

    CONSTRAINT "segment_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_areas" (
    "user_id" INTEGER NOT NULL,
    "area" VARCHAR(20) NOT NULL,

    CONSTRAINT "user_areas_pkey" PRIMARY KEY ("user_id","area")
);

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(120) NOT NULL,
    "area" VARCHAR(20) NOT NULL,
    "is_master" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "can_edit_ai_prompt" BOOLEAN NOT NULL DEFAULT false,
    "can_view_audit_logs" BOOLEAN NOT NULL DEFAULT false,
    "can_view_integration" BOOLEAN NOT NULL DEFAULT false,
    "can_edit_business_hours" BOOLEAN NOT NULL DEFAULT false,
    "can_view_reports" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_templates" (
    "id" SERIAL NOT NULL,
    "area" VARCHAR(20) NOT NULL,
    "meta_id" VARCHAR(64),
    "name" VARCHAR(200) NOT NULL,
    "language" VARCHAR(32) NOT NULL,
    "category" VARCHAR(80),
    "status" VARCHAR(40) NOT NULL,
    "components_json" JSONB NOT NULL DEFAULT '[]',
    "synced_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejection_reason" TEXT,
    "submitted_at" TIMESTAMPTZ(6),
    "submitted_by" INTEGER,
    "placeholder_aliases_json" JSONB,

    CONSTRAINT "whatsapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_audit_logs_actor_user" ON "audit_logs"("actor_user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_audit_logs_event_type" ON "audit_logs"("event_type");

-- CreateIndex
CREATE INDEX "idx_audit_logs_level" ON "audit_logs"("level");

-- CreateIndex
CREATE INDEX "idx_campaign_logs_campaign_id" ON "campaign_logs"("campaign_id");

-- CreateIndex
CREATE INDEX "idx_campaigns_area" ON "campaigns"("area");

-- CreateIndex
CREATE INDEX "idx_campaigns_auto_retry" ON "campaigns"("auto_retry_at");

-- CreateIndex
CREATE INDEX "idx_campaigns_scheduled" ON "campaigns"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_wa_unique" ON "chat_messages"("wa_message_id");

-- CreateIndex
CREATE INDEX "idx_chat_messages_body_trgm" ON "chat_messages" USING GIN ("body_text" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "idx_chat_messages_conv" ON "chat_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_contact_attr_defs_area" ON "contact_attribute_definitions"("area");

-- CreateIndex
CREATE UNIQUE INDEX "idx_contact_attr_defs_area_seg_slug" ON "contact_attribute_definitions"("area", "segment_slug", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "idx_contact_attr_defs_area_slug" ON "contact_attribute_definitions"("area", "slug");

-- CreateIndex
CREATE INDEX "idx_contact_attributes_contact" ON "contact_attributes"("contact_id");

-- CreateIndex
CREATE INDEX "idx_contact_attributes_key_value" ON "contact_attributes"("attr_key", "attr_value");

-- CreateIndex
CREATE UNIQUE INDEX "contact_attributes_contact_id_attr_key_key" ON "contact_attributes"("contact_id", "attr_key");

-- CreateIndex
CREATE INDEX "idx_contact_segments_area_slug" ON "contact_segments"("area", "segment_slug");

-- CreateIndex
CREATE INDEX "idx_contact_segments_contact" ON "contact_segments"("contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "contact_segments_contact_id_segment_slug_key" ON "contact_segments"("contact_id", "segment_slug");

-- CreateIndex
CREATE INDEX "idx_contacts_area" ON "contacts"("area");

-- CreateIndex
CREATE INDEX "idx_contacts_replaced_at" ON "contacts"("replaced_at" DESC);

-- CreateIndex
CREATE INDEX "idx_contacts_replaced_by_contact" ON "contacts"("replaced_by_contact_id");

-- CreateIndex
CREATE INDEX "idx_contacts_segment" ON "contacts"("segment");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_area_phone_key" ON "contacts"("area", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_tags_conv_label_uq" ON "conversation_tags"("conversation_id", "label");

-- CreateIndex
CREATE INDEX "idx_conversations_area_last_msg" ON "conversations"("area", "last_message_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "conversations_area_phone_key" ON "conversations"("area", "phone");

-- CreateIndex
CREATE INDEX "idx_login_logs_logged_at" ON "login_logs"("logged_at" DESC);

-- CreateIndex
CREATE INDEX "idx_login_logs_user_id" ON "login_logs"("user_id");

-- CreateIndex
CREATE INDEX "idx_meta_ctwa_ad_leads_ad" ON "meta_ctwa_ad_leads"("meta_ctwa_ad_id");

-- CreateIndex
CREATE UNIQUE INDEX "meta_ctwa_ad_leads_area_meta_ctwa_ad_id_conversation_id_key" ON "meta_ctwa_ad_leads"("area", "meta_ctwa_ad_id", "conversation_id");

-- CreateIndex
CREATE INDEX "idx_meta_ctwa_ads_area" ON "meta_ctwa_ads"("area");

-- CreateIndex
CREATE UNIQUE INDEX "meta_ctwa_ads_area_meta_source_id_key" ON "meta_ctwa_ads"("area", "meta_source_id");

-- CreateIndex
CREATE INDEX "idx_segment_definitions_area" ON "segment_definitions"("area");

-- CreateIndex
CREATE UNIQUE INDEX "segment_definitions_area_slug_key" ON "segment_definitions"("area", "slug");

-- CreateIndex
CREATE INDEX "idx_user_areas_area" ON "user_areas"("area");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_whatsapp_templates_area" ON "whatsapp_templates"("area");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_templates_area_name_language_key" ON "whatsapp_templates"("area", "name", "language");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_logs" ADD CONSTRAINT "campaign_logs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_logs" ADD CONSTRAINT "campaign_logs_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_attributes" ADD CONSTRAINT "contact_attributes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_segments" ADD CONSTRAINT "contact_segments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_replaced_by_contact_fkey" FOREIGN KEY ("replaced_by_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversation_tags" ADD CONSTRAINT "conversation_tags_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_meta_ctwa_ad_id_fkey" FOREIGN KEY ("meta_ctwa_ad_id") REFERENCES "meta_ctwa_ads"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meta_ctwa_ad_leads" ADD CONSTRAINT "meta_ctwa_ad_leads_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meta_ctwa_ad_leads" ADD CONSTRAINT "meta_ctwa_ad_leads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "meta_ctwa_ad_leads" ADD CONSTRAINT "meta_ctwa_ad_leads_meta_ctwa_ad_id_fkey" FOREIGN KEY ("meta_ctwa_ad_id") REFERENCES "meta_ctwa_ads"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_areas" ADD CONSTRAINT "user_areas_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;


-- Check constraints (paridad con migrations.js legacy)
ALTER TABLE "users" ADD CONSTRAINT "users_area_check" CHECK ("area" IN ('ti', 'pam', 'patronato', 'educacion', 'educacion_ca', 'educacion_ep'));
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_area_check" CHECK ("area" IN ('ti', 'pam', 'patronato', 'educacion', 'educacion_ca', 'educacion_ep'));
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_lead_score_check" CHECK ("lead_score" IS NULL OR ("lead_score" >= 1 AND "lead_score" <= 5));
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_area_check" CHECK ("area" IN ('ti', 'pam', 'patronato', 'educacion', 'educacion_ca', 'educacion_ep'));
ALTER TABLE "segment_definitions" ADD CONSTRAINT "segment_definitions_area_check" CHECK ("area" IN ('ti', 'pam', 'patronato', 'educacion', 'educacion_ca', 'educacion_ep'));
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_area_check" CHECK ("area" IN ('ti', 'pam', 'patronato', 'educacion', 'educacion_ca', 'educacion_ep'));
ALTER TABLE "whatsapp_templates" ADD CONSTRAINT "whatsapp_templates_area_check" CHECK ("area" IN ('ti', 'pam', 'patronato', 'educacion', 'educacion_ca', 'educacion_ep'));
ALTER TABLE "contact_segments" ADD CONSTRAINT "contact_segments_area_check" CHECK ("area" IN ('ti', 'pam', 'patronato', 'educacion', 'educacion_ca', 'educacion_ep'));
ALTER TABLE "contact_attribute_definitions" ADD CONSTRAINT "contact_attribute_definitions_area_check" CHECK ("area" IN ('ti', 'pam', 'patronato', 'educacion', 'educacion_ca', 'educacion_ep'));
ALTER TABLE "contact_attribute_definitions" ADD CONSTRAINT "contact_attribute_definitions_field_type_check" CHECK ("field_type" IN ('text', 'number', 'date'));
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_area_check" CHECK ("area" IN ('ti', 'pam', 'patronato', 'educacion', 'educacion_ca', 'educacion_ep', 'global'));
ALTER TABLE "user_areas" ADD CONSTRAINT "user_areas_area_check" CHECK ("area" IN ('ti', 'pam', 'patronato', 'educacion', 'educacion_ca', 'educacion_ep'));
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_direction_check" CHECK ("direction" IN ('inbound', 'outbound'));
