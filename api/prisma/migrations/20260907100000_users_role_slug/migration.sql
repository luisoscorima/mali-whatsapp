-- AlterTable
ALTER TABLE "users" ADD COLUMN "role_slug" VARCHAR(40);

CREATE INDEX "idx_users_role_slug" ON "users"("role_slug");
