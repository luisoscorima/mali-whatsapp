-- Supports bounded history pages and incremental polling within one chat.
CREATE INDEX "idx_chat_messages_conv_id" ON "chat_messages" ("conversation_id", "id");
