-- Timeout options + stable client_key on nodes
ALTER TABLE "flow_nodes"
  ADD COLUMN IF NOT EXISTS "client_key" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "timeout_repeat" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "timeout_max_nudges" INTEGER,
  ADD COLUMN IF NOT EXISTS "timeout_close_on_silence" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "timeout_window_guard" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "timeout_window_lead_minutes" INTEGER;

UPDATE "flow_nodes"
SET "client_key" = 'n_' || "id"::text
WHERE "client_key" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "flow_nodes_flow_client_key_uq"
  ON "flow_nodes"("flow_id", "client_key");

ALTER TABLE "flow_sessions"
  ADD COLUMN IF NOT EXISTS "timeout_nudge_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "flow_session_events" (
  "id" SERIAL PRIMARY KEY,
  "flow_id" INTEGER NOT NULL,
  "session_id" INTEGER NOT NULL,
  "conversation_id" INTEGER NOT NULL,
  "node_id" INTEGER,
  "client_key" VARCHAR(64),
  "node_kind" VARCHAR(32),
  "node_label" VARCHAR(200),
  "event_type" VARCHAR(32) NOT NULL,
  "match_payload" VARCHAR(256),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "idx_flow_events_flow_type"
  ON "flow_session_events"("flow_id", "event_type");
CREATE INDEX IF NOT EXISTS "idx_flow_events_flow_key_type"
  ON "flow_session_events"("flow_id", "client_key", "event_type");
CREATE INDEX IF NOT EXISTS "idx_flow_events_session"
  ON "flow_session_events"("session_id");
CREATE INDEX IF NOT EXISTS "idx_flow_events_conversation"
  ON "flow_session_events"("conversation_id");

ALTER TABLE "flow_session_events"
  DROP CONSTRAINT IF EXISTS "flow_session_events_flow_id_fkey",
  DROP CONSTRAINT IF EXISTS "flow_session_events_session_id_fkey";

ALTER TABLE "flow_session_events"
  ADD CONSTRAINT "flow_session_events_flow_id_fkey"
    FOREIGN KEY ("flow_id") REFERENCES "flows"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  ADD CONSTRAINT "flow_session_events_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "flow_sessions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
