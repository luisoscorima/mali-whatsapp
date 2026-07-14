-- Grupo de exclusión mutua para segmentos asignables desde chat (1 activo por grupo).
ALTER TABLE "segment_definitions"
  ADD COLUMN "assignment_group" VARCHAR(20);
