-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "can_manage_attributes" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "can_manage_segments" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "can_view_conversation_stats" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "can_view_campaign_stats" BOOLEAN NOT NULL DEFAULT false;
