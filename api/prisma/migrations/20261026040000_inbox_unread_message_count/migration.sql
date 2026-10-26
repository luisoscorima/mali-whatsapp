-- No existe historial fiable de lectura para reconstruir el contador anterior.
ALTER TABLE conversations ADD COLUMN unread_message_count INTEGER DEFAULT 0;
UPDATE conversations SET unread_message_count = NULL WHERE inbox_unread = TRUE;
ALTER TABLE conversations ADD CONSTRAINT conversations_unread_message_count_nonnegative
  CHECK (unread_message_count IS NULL OR unread_message_count >= 0);

CREATE FUNCTION reset_conversation_unread_count() RETURNS trigger AS $$
BEGIN
  IF NEW.inbox_unread = FALSE THEN
    NEW.unread_message_count := 0;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_reset_unread_count
BEFORE UPDATE OF inbox_unread ON conversations
FOR EACH ROW EXECUTE FUNCTION reset_conversation_unread_count();

-- AFTER INSERT evita contar reintentos del webhook descartados por ON CONFLICT.
-- El incremento atómico comparte el bloqueo de fila con la operación de lectura.
CREATE FUNCTION increment_conversation_unread_count() RETURNS trigger AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    UPDATE conversations
      SET inbox_unread = TRUE,
          unread_message_count = unread_message_count + 1
      WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_messages_increment_unread_count
AFTER INSERT ON chat_messages
FOR EACH ROW EXECUTE FUNCTION increment_conversation_unread_count();
