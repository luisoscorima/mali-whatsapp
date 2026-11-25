-- Realtime inbox: avisa al API (LISTEN inbox_events) solo al confirmar la transacción.
-- Captura todos los escritores: webhook, respuestas, flujos, IA, campañas y masivos.
CREATE FUNCTION notify_inbox_message() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     OLD.raw_payload IS NOT DISTINCT FROM NEW.raw_payload AND
     OLD.body_text IS NOT DISTINCT FROM NEW.body_text THEN
    RETURN NEW;
  END IF;
  PERFORM pg_notify('inbox_events', json_build_object(
    'k', CASE WHEN TG_OP = 'INSERT' THEN 'message.created' ELSE 'message.updated' END,
    'c', NEW.conversation_id,
    'm', NEW.id
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER chat_messages_inbox_notify
AFTER INSERT OR UPDATE ON chat_messages
FOR EACH ROW EXECUTE FUNCTION notify_inbox_message();

CREATE FUNCTION notify_inbox_conversation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
     OLD.last_message_at IS NOT DISTINCT FROM NEW.last_message_at AND
     OLD.last_user_message_at IS NOT DISTINCT FROM NEW.last_user_message_at AND
     OLD.inbox_unread IS NOT DISTINCT FROM NEW.inbox_unread AND
     OLD.unread_message_count IS NOT DISTINCT FROM NEW.unread_message_count AND
     OLD.archived IS NOT DISTINCT FROM NEW.archived AND
     OLD.status IS NOT DISTINCT FROM NEW.status AND
     OLD.assigned_user_id IS NOT DISTINCT FROM NEW.assigned_user_id AND
     OLD.automation_touched_at IS NOT DISTINCT FROM NEW.automation_touched_at AND
     OLD.contact_id IS NOT DISTINCT FROM NEW.contact_id AND
     OLD.whatsapp_line_id IS NOT DISTINCT FROM NEW.whatsapp_line_id AND
     OLD.wa_profile_name IS NOT DISTINCT FROM NEW.wa_profile_name THEN
    RETURN NEW;
  END IF;
  PERFORM pg_notify('inbox_events', json_build_object(
    'k', CASE WHEN TG_OP = 'INSERT' THEN 'conversation.created' ELSE 'conversation.updated' END,
    'c', NEW.id,
    'u', TG_OP = 'INSERT' OR OLD.inbox_unread IS DISTINCT FROM NEW.inbox_unread,
    'a', TG_OP = 'UPDATE' AND OLD.archived IS DISTINCT FROM NEW.archived
  )::text);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_inbox_notify
AFTER INSERT OR UPDATE ON conversations
FOR EACH ROW EXECUTE FUNCTION notify_inbox_conversation();
