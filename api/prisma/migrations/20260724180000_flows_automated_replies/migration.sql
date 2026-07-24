-- Respuestas automatizadas: flujos + vínculo opcional en campañas

CREATE TABLE "flows" (
    "id" SERIAL NOT NULL,
    "area" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'draft',
    "trigger_payload" VARCHAR(256) NOT NULL,
    "entry_node_id" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "flows_area_trigger_uq" ON "flows"("area", "trigger_payload");
CREATE INDEX "idx_flows_area_status" ON "flows"("area", "status");

CREATE TABLE "flow_nodes" (
    "id" SERIAL NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "body_text" TEXT,
    "buttons_json" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flow_nodes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_flow_nodes_flow" ON "flow_nodes"("flow_id");

CREATE TABLE "flow_edges" (
    "id" SERIAL NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "from_node_id" INTEGER NOT NULL,
    "to_node_id" INTEGER NOT NULL,
    "match_payload" VARCHAR(256),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flow_edges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_flow_edges_flow" ON "flow_edges"("flow_id");
CREATE INDEX "idx_flow_edges_from" ON "flow_edges"("from_node_id");

CREATE TABLE "flow_sessions" (
    "id" SERIAL NOT NULL,
    "conversation_id" INTEGER NOT NULL,
    "flow_id" INTEGER NOT NULL,
    "current_node_id" INTEGER,
    "status" VARCHAR(24) NOT NULL DEFAULT 'active',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "flow_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_flow_sessions_conv_status" ON "flow_sessions"("conversation_id", "status");
CREATE INDEX "idx_flow_sessions_flow" ON "flow_sessions"("flow_id");

ALTER TABLE "flow_nodes"
  ADD CONSTRAINT "flow_nodes_flow_id_fkey"
  FOREIGN KEY ("flow_id") REFERENCES "flows"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "flow_edges"
  ADD CONSTRAINT "flow_edges_flow_id_fkey"
  FOREIGN KEY ("flow_id") REFERENCES "flows"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "flow_edges"
  ADD CONSTRAINT "flow_edges_from_node_id_fkey"
  FOREIGN KEY ("from_node_id") REFERENCES "flow_nodes"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "flow_edges"
  ADD CONSTRAINT "flow_edges_to_node_id_fkey"
  FOREIGN KEY ("to_node_id") REFERENCES "flow_nodes"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "flow_sessions"
  ADD CONSTRAINT "flow_sessions_conversation_id_fkey"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "flow_sessions"
  ADD CONSTRAINT "flow_sessions_flow_id_fkey"
  FOREIGN KEY ("flow_id") REFERENCES "flows"("id")
  ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "flow_sessions"
  ADD CONSTRAINT "flow_sessions_current_node_id_fkey"
  FOREIGN KEY ("current_node_id") REFERENCES "flow_nodes"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;

ALTER TABLE "campaigns"
  ADD COLUMN "linked_flow_id" INTEGER;

CREATE INDEX "idx_campaigns_linked_flow" ON "campaigns"("linked_flow_id");

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_linked_flow_id_fkey"
  FOREIGN KEY ("linked_flow_id") REFERENCES "flows"("id")
  ON DELETE SET NULL ON UPDATE NO ACTION;
