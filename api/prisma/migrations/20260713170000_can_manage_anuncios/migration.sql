-- AlterTable
ALTER TABLE "users"
  ADD COLUMN "can_manage_anuncios" BOOLEAN NOT NULL DEFAULT false;
