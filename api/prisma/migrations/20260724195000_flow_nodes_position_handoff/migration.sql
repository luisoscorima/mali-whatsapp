ALTER TABLE "flow_nodes"
  ADD COLUMN IF NOT EXISTS "position_x" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "position_y" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "handoff_user_id" INTEGER;

CREATE INDEX IF NOT EXISTS "idx_flow_nodes_handoff_user" ON "flow_nodes"("handoff_user_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'flow_nodes_handoff_user_id_fkey'
  ) THEN
    ALTER TABLE "flow_nodes"
      ADD CONSTRAINT "flow_nodes_handoff_user_id_fkey"
      FOREIGN KEY ("handoff_user_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;
