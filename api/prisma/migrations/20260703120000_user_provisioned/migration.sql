-- Usuarios nuevos por Google OAuth empiezan sin acceso hasta que un admin los configure.
-- Usuarios ya existentes en prod conservan acceso.
ALTER TABLE "users" ADD COLUMN "is_provisioned" BOOLEAN NOT NULL DEFAULT false;

UPDATE "users" SET "is_provisioned" = true;
