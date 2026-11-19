-- Shadow facts only: no backfill, deletion or changes to commercial authority.
-- Capture every writer (inbox, management, distribution, payment and expiry).
CREATE FUNCTION enqueue_education_cycle_shadow() RETURNS trigger AS $$
DECLARE
  event_row_id integer;
BEGIN
  IF TG_OP = 'UPDATE' AND
     OLD.lead_status_id IS NOT DISTINCT FROM NEW.lead_status_id AND
     OLD.assigned_user_id IS NOT DISTINCT FROM NEW.assigned_user_id AND
     OLD.closed_at IS NOT DISTINCT FROM NEW.closed_at AND
     OLD.close_reason IS NOT DISTINCT FROM NEW.close_reason THEN
    RETURN NEW;
  END IF;

  event_row_id := nextval(pg_get_serial_sequence('commercial_channel_outbox', 'id'));
  INSERT INTO commercial_channel_outbox
    (id, event_id, event_type, payload, occurred_at)
  VALUES (
    event_row_id, 'wa-cycle-' || NEW.id || '-event-' || event_row_id,
    'education.cycle.' || lower(TG_OP),
    jsonb_build_object(
      'source', 'mali-whatsapp', 'shadow', true, 'writer', 'wa',
      'wa_cycle_id', NEW.id, 'contact_id', NEW.contact_id,
      'management_area', NEW.area, 'program_id', NEW.program_id,
      'to_lead_status_id', NEW.lead_status_id,
      'to_assigned_user_id', NEW.assigned_user_id,
      'closed_at', NEW.closed_at, 'close_reason', NEW.close_reason
    ), clock_timestamp()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER education_cycle_shadow_outbox
AFTER INSERT OR UPDATE ON education_lead_cycles
FOR EACH ROW EXECUTE FUNCTION enqueue_education_cycle_shadow();
