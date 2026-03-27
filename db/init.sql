CREATE TABLE IF NOT EXISTS contacts (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  phone VARCHAR(20) NOT NULL UNIQUE,
  segment VARCHAR(50) NOT NULL,
  opt_in BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id SERIAL PRIMARY KEY,
  segment VARCHAR(50) NOT NULL,
  template_name VARCHAR(100) NOT NULL,
  message_text TEXT NOT NULL,
  image_url TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'queued',
  total_recipients INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS campaign_logs (
  id SERIAL PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  phone VARCHAR(20) NOT NULL,
  whatsapp_message_id VARCHAR(150),
  status VARCHAR(30) NOT NULL,
  response JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contacts_segment ON contacts(segment);
CREATE INDEX IF NOT EXISTS idx_campaign_logs_campaign_id ON campaign_logs(campaign_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

