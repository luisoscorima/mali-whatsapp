-- CreateTable
CREATE TABLE "commercial_channel_outbox" (
    "id" SERIAL NOT NULL,
    "event_id" VARCHAR(80) NOT NULL,
    "event_type" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "delivered_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),

    CONSTRAINT "commercial_channel_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commercial_channel_outbox_event_id_key" ON "commercial_channel_outbox"("event_id");
CREATE INDEX "commercial_channel_outbox_pending_idx" ON "commercial_channel_outbox"("delivered_at", "id");
