-- Los segmentos existentes quedaron assignable=true por el DEFAULT de la migración anterior.
-- Opt-in explícito: solo los marcados en UI aparecen en "Asignar desde chat".
ALTER TABLE "segment_definitions" ALTER COLUMN "assignable" SET DEFAULT false;
UPDATE "segment_definitions" SET "assignable" = false WHERE "assignable" = true;
