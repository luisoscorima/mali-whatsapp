-- Acelera last_outbound_message_at por conversación (direction + created_at).
CREATE INDEX "idx_chat_messages_conv_dir_created" ON "chat_messages"("conversation_id", "direction", "created_at");
