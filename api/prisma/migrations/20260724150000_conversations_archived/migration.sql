-- Manual archive flag; auto-archive is derived from last_user_message_at IS NULL
ALTER TABLE "conversations" ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "idx_conversations_area_archived" ON "conversations"("area", "archived");
