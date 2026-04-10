/**
 * Esquema idempotente del panel MALI WhatsApp (PostgreSQL).
 * Fuente única de verdad: arrancar la app en BD vacía crea todo lo necesario.
 * Jerarquía de negocio: áreas → usuarios → segmentos → contactos; campañas y chat por área.
 */

async function runMigrations(query) {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(120) NOT NULL UNIQUE,
      password_hash VARCHAR(120) NOT NULL,
      area VARCHAR(20) NOT NULL CHECK (area IN ('pam', 'educacion')),
      is_master BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  const hasUsername = await query(
    `SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'username'`
  );
  if (hasUsername.rows.length > 0) {
    try {
      await query(`ALTER TABLE users RENAME COLUMN username TO email`);
    } catch {
      /* ya migrado */
    }
  }
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_master BOOLEAN NOT NULL DEFAULT FALSE`);

  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      area VARCHAR(20) NOT NULL CHECK (area IN ('pam', 'educacion')),
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (area, key)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS contacts (
      id SERIAL PRIMARY KEY,
      name VARCHAR(150) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      segment VARCHAR(50) NOT NULL,
      area VARCHAR(20) NOT NULL DEFAULT 'pam' CHECK (area IN ('pam', 'educacion')),
      opt_in BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (area, phone)
    )
  `);
  await query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS area VARCHAR(20)`);
  await query(`UPDATE contacts SET area = 'pam' WHERE area IS NULL OR area = ''`);
  await query(`ALTER TABLE contacts ALTER COLUMN area SET DEFAULT 'pam'`);
  try {
    await query(`ALTER TABLE contacts ALTER COLUMN area SET NOT NULL`);
  } catch {
    /* ya NOT NULL */
  }
  await query(`ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_phone_key`);
  try {
    await query(
      `ALTER TABLE contacts ADD CONSTRAINT contacts_area_phone_key UNIQUE (area, phone)`
    );
  } catch {
    /* restricción única ya presente */
  }
  await query(`CREATE INDEX IF NOT EXISTS idx_contacts_segment ON contacts(segment)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_contacts_area ON contacts(area)`);

  await query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      area VARCHAR(20) NOT NULL DEFAULT 'pam' CHECK (area IN ('pam', 'educacion')),
      segment VARCHAR(50) NOT NULL,
      template_name VARCHAR(100) NOT NULL,
      message_text TEXT NOT NULL,
      image_url TEXT,
      status VARCHAR(30) NOT NULL DEFAULT 'queued',
      total_recipients INTEGER NOT NULL DEFAULT 0,
      campaign_payload JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS area VARCHAR(20)`);
  await query(`UPDATE campaigns SET area = 'pam' WHERE area IS NULL OR area = ''`);
  await query(`ALTER TABLE campaigns ALTER COLUMN area SET DEFAULT 'pam'`);
  try {
    await query(`ALTER TABLE campaigns ALTER COLUMN area SET NOT NULL`);
  } catch {
    /* ya NOT NULL */
  }
  await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_payload JSONB`);
  await query(`CREATE INDEX IF NOT EXISTS idx_campaigns_area ON campaigns(area)`);

  await query(`
    CREATE TABLE IF NOT EXISTS campaign_logs (
      id SERIAL PRIMARY KEY,
      campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
      contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      phone VARCHAR(20) NOT NULL,
      whatsapp_message_id VARCHAR(150),
      status VARCHAR(30) NOT NULL,
      response JSONB,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_campaign_logs_campaign_id ON campaign_logs(campaign_id)`);

  const col = await query(
    `SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'app_settings' AND column_name = 'area'`
  );
  if (col.rows.length === 0) {
    await query(`ALTER TABLE app_settings ADD COLUMN area VARCHAR(20) DEFAULT 'pam'`);
    await query(`UPDATE app_settings SET area = 'pam' WHERE area IS NULL`);
    await query(`ALTER TABLE app_settings ALTER COLUMN area SET NOT NULL`);
    await query(`ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey`);
    await query(`ALTER TABLE app_settings ADD PRIMARY KEY (area, key)`);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS segment_definitions (
      id SERIAL PRIMARY KEY,
      area VARCHAR(20) NOT NULL CHECK (area IN ('pam', 'educacion')),
      slug VARCHAR(50) NOT NULL,
      label VARCHAR(120) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      UNIQUE (area, slug)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_segment_definitions_area ON segment_definitions(area)`
  );

  const segCount = await query(`SELECT COUNT(*)::int AS c FROM segment_definitions`);
  if (segCount.rows[0].c === 0) {
    const seedRows = [
      ['pam', 'suscriptor_1', 'Suscriptor 1', 1],
      ['pam', 'suscriptor_2', 'Suscriptor 2', 2],
      ['pam', 'suscriptor_3', 'Suscriptor 3', 3],
      ['pam', 'asociado', 'Asociado', 4],
      ['educacion', 'suscriptor_1', 'Suscriptor 1', 1],
      ['educacion', 'suscriptor_2', 'Suscriptor 2', 2],
      ['educacion', 'suscriptor_3', 'Suscriptor 3', 3],
      ['educacion', 'asociado', 'Asociado', 4],
    ];
    for (const [ar, slug, label, sort_order] of seedRows) {
      await query(
        `INSERT INTO segment_definitions (area, slug, label, sort_order) VALUES ($1, $2, $3, $4)`,
        [ar, slug, label, sort_order]
      );
    }
  }

  await query(`
    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      area VARCHAR(20) NOT NULL CHECK (area IN ('pam', 'educacion')),
      phone VARCHAR(20) NOT NULL,
      contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      last_user_message_at TIMESTAMP WITH TIME ZONE,
      last_message_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (area, phone)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_conversations_area_last_msg ON conversations(area, last_message_at DESC)`
  );

  await query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      direction VARCHAR(12) NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      wa_message_id VARCHAR(150),
      body_text TEXT,
      message_type VARCHAR(32) NOT NULL DEFAULT 'text',
      raw_payload JSONB,
      created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_chat_messages_conv ON chat_messages(conversation_id, created_at)`
  );
  await query(
    `CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_wa_unique ON chat_messages (wa_message_id) WHERE wa_message_id IS NOT NULL`
  );

  try {
    await query(`CREATE EXTENSION IF NOT EXISTS pg_trgm`);
  } catch {
    /* sin permiso CREATE EXTENSION en algunos entornos */
  }
  try {
    await query(
      `CREATE INDEX IF NOT EXISTS idx_chat_messages_body_trgm ON chat_messages USING gin (body_text gin_trgm_ops)`
    );
  } catch {
    /* índice requiere pg_trgm */
  }

  await query(`
    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id SERIAL PRIMARY KEY,
      area VARCHAR(20) NOT NULL CHECK (area IN ('pam', 'educacion')),
      meta_id VARCHAR(64),
      name VARCHAR(200) NOT NULL,
      language VARCHAR(32) NOT NULL,
      category VARCHAR(80),
      status VARCHAR(40) NOT NULL,
      components_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      UNIQUE (area, name, language)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_whatsapp_templates_area ON whatsapp_templates(area)`
  );

  /* Credenciales Meta globales: area = 'global' en app_settings */
  try {
    await query(`ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_area_check`);
  } catch {
    /* */
  }
  try {
    await query(`ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_check`);
  } catch {
    /* */
  }
  try {
    await query(
      `ALTER TABLE app_settings ADD CONSTRAINT app_settings_area_check CHECK (area IN ('pam', 'educacion', 'global'))`
    );
  } catch {
    /* ya aplicado o otro nombre de constraint */
  }
}

module.exports = { runMigrations };
