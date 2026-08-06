ALTER TABLE "flow_nodes"
  ADD COLUMN "timeout_minutes" INTEGER,
  ADD COLUMN "timeout_body_text" TEXT;

ALTER TABLE "flow_sessions"
  ADD COLUMN "timeout_at" TIMESTAMPTZ(6),
  ADD COLUMN "timeout_sent_at" TIMESTAMPTZ(6);

CREATE INDEX "idx_flow_sessions_status_timeout"
  ON "flow_sessions"("status", "timeout_at");
