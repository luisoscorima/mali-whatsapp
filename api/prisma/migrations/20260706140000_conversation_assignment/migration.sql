-- AlterTable
ALTER TABLE "conversations" ADD COLUMN "assigned_user_id" INTEGER,
ADD COLUMN "assigned_at" TIMESTAMPTZ(6),
ADD COLUMN "automation_touched_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "users" ADD COLUMN "can_assign_conversations" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "first_name" VARCHAR(80),
ADD COLUMN "last_name" VARCHAR(80);

-- CreateIndex
CREATE INDEX "idx_conversations_area_assignee" ON "conversations"("area", "assigned_user_id");

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
