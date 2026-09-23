BEGIN;

CREATE INDEX idx_conversations_contact_area ON conversations (contact_id, area);

CREATE TABLE education_lead_cycles (
  id SERIAL PRIMARY KEY,
  area VARCHAR(20) NOT NULL,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  started_at TIMESTAMPTZ(6) NOT NULL,
  last_interaction_at TIMESTAMPTZ(6) NOT NULL,
  assigned_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  lead_status_id INTEGER REFERENCES lead_status_definitions(id) ON DELETE SET NULL,
  lead_score SMALLINT,
  requires_review BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT education_lead_cycles_area_check CHECK (area IN ('educacion', 'educacion_ca', 'educacion_ep')),
  CONSTRAINT education_lead_cycles_score_check CHECK (lead_score IS NULL OR lead_score BETWEEN 1 AND 5),
  CONSTRAINT education_lead_cycles_contact_started_key UNIQUE (contact_id, started_at)
);
CREATE INDEX education_lead_cycles_contact_started_idx ON education_lead_cycles (contact_id, started_at DESC);
CREATE INDEX education_lead_cycles_area_assignee_idx ON education_lead_cycles (area, assigned_user_id);

CREATE TABLE education_lead_entries (
  id SERIAL PRIMARY KEY,
  area VARCHAR(20) NOT NULL,
  contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  origin_id INTEGER REFERENCES contact_origins(id) ON DELETE SET NULL,
  channel VARCHAR(32) NOT NULL,
  source_key VARCHAR(128),
  source_label VARCHAR(200),
  cycle_id INTEGER REFERENCES education_lead_cycles(id) ON DELETE SET NULL,
  event_key VARCHAR(160) NOT NULL,
  occurred_at TIMESTAMPTZ(6) NOT NULL,
  classification VARCHAR(20) NOT NULL,
  assignment_rule VARCHAR(24) NOT NULL,
  conflict_reason VARCHAR(80),
  previous_assigned_user_id INTEGER,
  previous_advisor_label VARCHAR(200),
  previous_status_label VARCHAR(120),
  previous_interaction_at TIMESTAMPTZ(6),
  reviewed_at TIMESTAMPTZ(6),
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT education_lead_entries_area_check CHECK (area IN ('educacion', 'educacion_ca', 'educacion_ep')),
  CONSTRAINT education_lead_entries_classification_check
    CHECK (classification IN ('new', 'duplicate', 'conflict', 'dismissed')),
  CONSTRAINT education_lead_entries_assignment_rule_check
    CHECK (assignment_rule IN ('new_number', 'same_advisor', 'reassignable', 'conflict')),
  CONSTRAINT education_lead_entries_area_event_key_key UNIQUE (area, event_key)
);
CREATE INDEX education_lead_entries_area_occurred_idx ON education_lead_entries (area, occurred_at DESC);
CREATE INDEX education_lead_entries_area_class_idx ON education_lead_entries (area, classification, occurred_at DESC);
CREATE INDEX education_lead_entries_area_rule_idx ON education_lead_entries (area, assignment_rule, occurred_at DESC);
CREATE INDEX education_lead_entries_contact_occurred_idx ON education_lead_entries (contact_id, occurred_at DESC);
CREATE INDEX education_lead_entries_cycle_idx ON education_lead_entries (cycle_id);

-- Preserve every origin and use all inbound messages for the 60-day clock.
-- Only the first inbound of a new 24-hour session becomes a visible entry.
-- Historical cycles before the current one have no reliable status/owner snapshot.
CREATE TEMP TABLE education_seed_events AS
WITH organic_returns AS (
  SELECT m.id, m.created_at, c.area, c.contact_id, c.id AS conversation_id,
         LAG(m.created_at) OVER (PARTITION BY c.id ORDER BY m.created_at, m.id) AS previous_at
  FROM chat_messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE m.direction = 'inbound'
    AND c.area IN ('educacion', 'educacion_ca', 'educacion_ep')
    AND c.contact_id IS NOT NULL
)
SELECT o.area, o.contact_id, o.id AS origin_id,
       o.channel, o.source_key, o.source_label,
       'origin:' || o.id::text AS event_key, o.first_seen_at AS occurred_at,
       TRUE AS is_entry
FROM contact_origins o
WHERE o.area IN ('educacion', 'educacion_ca', 'educacion_ep') AND o.contact_id IS NOT NULL
UNION ALL
SELECT r.area, r.contact_id, NULL::integer,
       'organic_wa', NULL::varchar, 'WhatsApp orgánico',
       'inbound:' || r.id::text, r.created_at,
       (r.previous_at IS NULL OR r.created_at >= r.previous_at + INTERVAL '24 hours')
       AND NOT EXISTS (
         SELECT 1 FROM contact_origins o
         WHERE o.contact_id = r.contact_id AND o.area = r.area
           AND o.first_seen_at BETWEEN r.created_at - INTERVAL '24 hours'
                                   AND r.created_at + INTERVAL '24 hours'
       )
FROM organic_returns r
;

CREATE TEMP TABLE education_seed_grouped AS
WITH ordered AS (
  SELECT e.*,
         LAG(e.occurred_at) OVER (PARTITION BY e.contact_id ORDER BY e.occurred_at, e.event_key) AS previous_at
  FROM education_seed_events e
), numbered AS (
  SELECT ordered.*,
         SUM(CASE WHEN previous_at IS NULL OR occurred_at > previous_at + INTERVAL '60 days'
             THEN 1 ELSE 0 END)
           OVER (PARTITION BY contact_id ORDER BY occurred_at, event_key) AS cycle_no
  FROM ordered
)
SELECT * FROM numbered;

INSERT INTO education_lead_cycles (
  area, contact_id, started_at, last_interaction_at,
  assigned_user_id, lead_status_id, lead_score
)
SELECT g.area, g.contact_id, MIN(g.occurred_at), MAX(g.occurred_at),
       CASE WHEN g.cycle_no = (SELECT MAX(x.cycle_no) FROM education_seed_grouped x WHERE x.contact_id = g.contact_id)
            THEN (SELECT c.assigned_user_id FROM conversations c
                  WHERE c.contact_id = g.contact_id AND c.area = g.area
                  ORDER BY c.id DESC LIMIT 1) END,
       CASE WHEN g.cycle_no = (SELECT MAX(x.cycle_no) FROM education_seed_grouped x WHERE x.contact_id = g.contact_id)
            THEN (SELECT c.lead_status_id FROM contacts c WHERE c.id = g.contact_id) END,
       CASE WHEN g.cycle_no = (SELECT MAX(x.cycle_no) FROM education_seed_grouped x WHERE x.contact_id = g.contact_id)
            THEN (SELECT c.lead_score FROM contacts c WHERE c.id = g.contact_id) END
FROM education_seed_grouped g
GROUP BY g.area, g.contact_id, g.cycle_no;

-- Messages inside a cycle extend the inactivity clock even when they do not
-- create another captación row (a continuous conversation can last months).
UPDATE education_lead_cycles cycle
SET last_interaction_at = GREATEST(cycle.last_interaction_at,
  COALESCE((
    SELECT MAX(m.created_at)
    FROM conversations conv
    JOIN chat_messages m ON m.conversation_id = conv.id AND m.direction = 'inbound'
    WHERE conv.contact_id = cycle.contact_id AND conv.area = cycle.area
      AND m.created_at >= cycle.started_at
      AND m.created_at < COALESCE(
        (SELECT MIN(next_cycle.started_at)
         FROM education_lead_cycles next_cycle
         WHERE next_cycle.contact_id = cycle.contact_id
           AND next_cycle.started_at > cycle.started_at),
        'infinity'::timestamptz)
  ), cycle.last_interaction_at));

INSERT INTO education_lead_entries (
  area, contact_id, origin_id, channel, source_key, source_label,
  cycle_id, event_key, occurred_at, classification, assignment_rule,
  previous_interaction_at, reviewed_at
)
SELECT g.area, g.contact_id, g.origin_id, g.channel, g.source_key, g.source_label,
       c.id, g.event_key, g.occurred_at,
       CASE WHEN g.event_key = (
         SELECT first_entry.event_key FROM education_seed_grouped first_entry
         WHERE first_entry.contact_id = g.contact_id
           AND first_entry.cycle_no = g.cycle_no AND first_entry.is_entry
         ORDER BY first_entry.occurred_at, first_entry.event_key LIMIT 1
       ) THEN 'new' ELSE 'duplicate' END,
       CASE WHEN g.cycle_no = 1 AND g.event_key = (
         SELECT first_entry.event_key FROM education_seed_grouped first_entry
         WHERE first_entry.contact_id = g.contact_id AND first_entry.cycle_no = g.cycle_no
           AND first_entry.is_entry
         ORDER BY first_entry.occurred_at, first_entry.event_key LIMIT 1
       ) THEN 'new_number'
       WHEN g.event_key = (
         SELECT first_entry.event_key FROM education_seed_grouped first_entry
         WHERE first_entry.contact_id = g.contact_id AND first_entry.cycle_no = g.cycle_no
           AND first_entry.is_entry
         ORDER BY first_entry.occurred_at, first_entry.event_key LIMIT 1
       ) THEN 'reassignable' ELSE 'same_advisor' END,
       g.previous_at,
       NOW()
FROM education_seed_grouped g
JOIN education_lead_cycles c ON c.contact_id = g.contact_id
 AND c.started_at = (SELECT MIN(g2.occurred_at) FROM education_seed_grouped g2
                     WHERE g2.contact_id = g.contact_id AND g2.cycle_no = g.cycle_no)
WHERE g.is_entry
ON CONFLICT (area, event_key) DO NOTHING;

DROP TABLE education_seed_grouped;
DROP TABLE education_seed_events;

COMMIT;
