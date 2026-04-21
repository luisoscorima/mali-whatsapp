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
      area VARCHAR(20) NOT NULL CHECK (area IN ('ti', 'pam', 'educacion')),
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
  await query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE`
  );
  await query(
    `ALTER TABLE users ADD COLUMN IF NOT EXISTS can_edit_ai_prompt BOOLEAN NOT NULL DEFAULT FALSE`
  );

  await query(`
    CREATE TABLE IF NOT EXISTS login_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email VARCHAR(120) NOT NULL,
      logged_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS idx_login_logs_logged_at ON login_logs(logged_at DESC)`);
  await query(`CREATE INDEX IF NOT EXISTS idx_login_logs_user_id ON login_logs(user_id)`);
  await query(`ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS logged_out_at TIMESTAMPTZ NULL`);
  await query(`ALTER TABLE login_logs ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ`);
  await query(`UPDATE login_logs SET last_seen_at = logged_at WHERE last_seen_at IS NULL`);

  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      area VARCHAR(20) NOT NULL CHECK (area IN ('ti', 'pam', 'educacion', 'global')),
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
      area VARCHAR(20) NOT NULL DEFAULT 'ti' CHECK (area IN ('ti', 'pam', 'educacion')),
      opt_in BOOLEAN NOT NULL DEFAULT TRUE,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (area, phone)
    )
  `);
  await query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS area VARCHAR(20)`);
  await query(`UPDATE contacts SET area = 'ti' WHERE area IS NULL OR area = ''`);
  await query(`ALTER TABLE contacts ALTER COLUMN area SET DEFAULT 'ti'`);
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
  await query(`ALTER TABLE contacts ADD COLUMN IF NOT EXISTS lead_score SMALLINT`);
  await query(`ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_lead_score_check`);
  await query(
    `ALTER TABLE contacts ADD CONSTRAINT contacts_lead_score_check CHECK (lead_score IS NULL OR (lead_score >= 1 AND lead_score <= 5))`
  );

  await query(`
    CREATE TABLE IF NOT EXISTS campaigns (
      id SERIAL PRIMARY KEY,
      area VARCHAR(20) NOT NULL DEFAULT 'ti' CHECK (area IN ('ti', 'pam', 'educacion')),
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
  await query(`UPDATE campaigns SET area = 'ti' WHERE area IS NULL OR area = ''`);
  await query(`ALTER TABLE campaigns ALTER COLUMN area SET DEFAULT 'ti'`);
  try {
    await query(`ALTER TABLE campaigns ALTER COLUMN area SET NOT NULL`);
  } catch {
    /* ya NOT NULL */
  }
  await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS campaign_payload JSONB`);
  /** NULL = envío inmediato; con status scheduled indica la hora UTC de inicio del envío. */
  await query(`ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ NULL`);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_campaigns_scheduled ON campaigns (status, scheduled_at) WHERE status = 'scheduled'`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_campaigns_area ON campaigns(area)`);
  try {
    await query(`ALTER TABLE campaigns ALTER COLUMN segment TYPE TEXT`);
  } catch {
    /* ya TEXT o sin columna */
  }

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
    await query(`ALTER TABLE app_settings ADD COLUMN area VARCHAR(20) DEFAULT 'ti'`);
    await query(`UPDATE app_settings SET area = 'ti' WHERE area IS NULL`);
    await query(`ALTER TABLE app_settings ALTER COLUMN area SET NOT NULL`);
    await query(`ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_pkey`);
    await query(`ALTER TABLE app_settings ADD PRIMARY KEY (area, key)`);
  }

  await query(`
    CREATE TABLE IF NOT EXISTS segment_definitions (
      id SERIAL PRIMARY KEY,
      area VARCHAR(20) NOT NULL CHECK (area IN ('ti', 'pam', 'educacion')),
      slug VARCHAR(50) NOT NULL,
      label VARCHAR(120) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      UNIQUE (area, slug)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_segment_definitions_area ON segment_definitions(area)`
  );
  await query(
    `ALTER TABLE segment_definitions ADD COLUMN IF NOT EXISTS color_key VARCHAR(16) NOT NULL DEFAULT 'teal'`
  );

  await query(`
    CREATE TABLE IF NOT EXISTS contact_segments (
      id SERIAL PRIMARY KEY,
      contact_id INTEGER NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
      area VARCHAR(20) NOT NULL CHECK (area IN ('ti', 'pam', 'educacion')),
      segment_slug VARCHAR(50) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (contact_id, segment_slug)
    )
  `);
  await query(
    `CREATE INDEX IF NOT EXISTS idx_contact_segments_area_slug ON contact_segments(area, segment_slug)`
  );
  await query(`CREATE INDEX IF NOT EXISTS idx_contact_segments_contact ON contact_segments(contact_id)`);

  await migrateContactSegmentsBridge(query);

  try {
    await query(`ALTER TABLE contacts ALTER COLUMN segment DROP NOT NULL`);
  } catch {
    /* ya nullable */
  }

  const segCount = await query(`SELECT COUNT(*)::int AS c FROM segment_definitions`);
  if (segCount.rows[0].c === 0) {
    const seedRows = [
      ['ti', 'suscriptor_1', 'Suscriptor 1', 1],
      ['ti', 'suscriptor_2', 'Suscriptor 2', 2],
      ['ti', 'suscriptor_3', 'Suscriptor 3', 3],
      ['ti', 'asociado', 'Asociado', 4],
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
      area VARCHAR(20) NOT NULL CHECK (area IN ('ti', 'pam', 'educacion')),
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
  await query(
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS inbox_unread BOOLEAN NOT NULL DEFAULT FALSE`
  );
  await query(
    `ALTER TABLE conversations ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'bot'`
  );

  const defaultPrompt =
    'Eres un asistente virtual del MALI. Responde en español de forma breve y profesional. Si el usuario necesita hablar con un humano, responde únicamente con la palabra clave de transferencia que se te indica.';
  const defaultTransfer = '[TRANSFERIR]';
  const tiAiConfig = JSON.stringify({
    enabled: true,
    prompt: defaultPrompt,
    transfer_keyword: defaultTransfer,
  });
  const pamEduAiConfig = JSON.stringify({
    enabled: false,
    prompt: defaultPrompt,
    transfer_keyword: defaultTransfer,
  });
  await query(
    `INSERT INTO app_settings (area, key, value, updated_at) VALUES ('ti', 'ai_config', $1, NOW())
     ON CONFLICT (area, key) DO NOTHING`,
    [tiAiConfig]
  );
  for (const area of ['pam', 'educacion']) {
    await query(
      `INSERT INTO app_settings (area, key, value, updated_at) VALUES ($1, 'ai_config', $2, NOW())
       ON CONFLICT (area, key) DO NOTHING`,
      [area, pamEduAiConfig]
    );
  }
  await migrateAiTiOnlyEnabled(query);

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

  await query(
    `ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS is_ai BOOLEAN NOT NULL DEFAULT FALSE`
  );
  try {
    await query(`ALTER TABLE conversations DROP COLUMN IF EXISTS ai_enabled`);
  } catch {
    /* */
  }

  await query(`
    CREATE TABLE IF NOT EXISTS whatsapp_templates (
      id SERIAL PRIMARY KEY,
      area VARCHAR(20) NOT NULL CHECK (area IN ('ti', 'pam', 'educacion')),
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
      `ALTER TABLE app_settings ADD CONSTRAINT app_settings_area_check CHECK (area IN ('ti', 'pam', 'educacion', 'global'))`
    );
  } catch {
    /* ya aplicado o otro nombre de constraint */
  }

  await migratePamSlugToTiThreeAreas(query);
  await cleanUpCrossAreaSeededSegments(query);
}

/** Una sola vez: en BD antigua (solo pam+educacion) renombrar datos pam → ti; en BD nueva ya hay ti+pam+educacion sin tocar. */
/** Puebla contact_segments desde contacts.segment (una vez) y marca flag global. */
async function migrateContactSegmentsBridge(query) {
  const flag = 'migration.contact_segments_bridge_v1';
  const done = await query(`SELECT 1 AS ok FROM app_settings WHERE area = 'global' AND key = $1`, [flag]);
  if (done.rows.length > 0) {
    return;
  }

  await query(`
    INSERT INTO contact_segments (contact_id, area, segment_slug)
    SELECT id, area, TRIM(segment)
    FROM contacts
    WHERE segment IS NOT NULL AND TRIM(segment) <> ''
    ON CONFLICT (contact_id, segment_slug) DO NOTHING
  `);

  await query(
    `INSERT INTO app_settings (area, key, value, updated_at) VALUES ('global', $1, '1', NOW())
     ON CONFLICT (area, key) DO UPDATE SET value = '1', updated_at = NOW()`,
    [flag]
  );
}

async function migratePamSlugToTiThreeAreas(query) {
  const flag = `migration.pam_legacy_to_ti_v1`;
  const done = await query(`SELECT 1 AS ok FROM app_settings WHERE area = 'global' AND key = $1`, [
    flag,
  ]);
  if (done.rows.length > 0) {
    await ensureAreaConstraintsThreeWay(query);
    return;
  }

  const tiSeg = await query(`SELECT COUNT(*)::int AS c FROM segment_definitions WHERE area = 'ti'`);
  const pamSeg = await query(`SELECT COUNT(*)::int AS c FROM segment_definitions WHERE area = 'pam'`);
  const isFreshThreeArea =
    Number(tiSeg.rows[0].c || 0) > 0 && Number(pamSeg.rows[0].c || 0) > 0;

  if (isFreshThreeArea) {
    await query(
      `INSERT INTO app_settings (area, key, value, updated_at) VALUES ('global', $1, '1', NOW())
       ON CONFLICT (area, key) DO UPDATE SET value = '1', updated_at = NOW()`,
      [flag]
    );
    await ensureAreaConstraintsThreeWay(query);
    return;
  }

  const tables = [
    'users',
    'contacts',
    'campaigns',
    'segment_definitions',
    'conversations',
    'whatsapp_templates',
  ];
  for (const t of tables) {
    await query(`ALTER TABLE ${t} DROP CONSTRAINT IF EXISTS ${t}_area_check`);
  }
  await query(`ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_area_check`);
  await query(`ALTER TABLE app_settings DROP CONSTRAINT IF EXISTS app_settings_check`);

  await query(`UPDATE users SET area = 'ti' WHERE area = 'pam'`);
  await query(`UPDATE contacts SET area = 'ti' WHERE area = 'pam'`);
  await query(`UPDATE campaigns SET area = 'ti' WHERE area = 'pam'`);
  await query(`UPDATE segment_definitions SET area = 'ti' WHERE area = 'pam'`);
  await query(`UPDATE conversations SET area = 'ti' WHERE area = 'pam'`);
  await query(`UPDATE whatsapp_templates SET area = 'ti' WHERE area = 'pam'`);
  await query(`UPDATE app_settings SET area = 'ti' WHERE area = 'pam'`);

  await query(
    `INSERT INTO app_settings (area, key, value, updated_at) VALUES ('global', $1, '1', NOW())
     ON CONFLICT (area, key) DO UPDATE SET value = '1', updated_at = NOW()`,
    [flag]
  );

  await ensureAreaConstraintsThreeWay(query);
}

async function ensureAreaConstraintsThreeWay(query) {
  const add = async (sql) => {
    try {
      await query(sql);
    } catch {
      /* ya existe o esquema nuevo sin necesidad */
    }
  };
  await add(
    `ALTER TABLE users ADD CONSTRAINT users_area_check CHECK (area IN ('ti', 'pam', 'educacion'))`
  );
  await add(
    `ALTER TABLE contacts ADD CONSTRAINT contacts_area_check CHECK (area IN ('ti', 'pam', 'educacion'))`
  );
  await add(
    `ALTER TABLE campaigns ADD CONSTRAINT campaigns_area_check CHECK (area IN ('ti', 'pam', 'educacion'))`
  );
  await add(
    `ALTER TABLE segment_definitions ADD CONSTRAINT segment_definitions_area_check CHECK (area IN ('ti', 'pam', 'educacion'))`
  );
  await add(
    `ALTER TABLE conversations ADD CONSTRAINT conversations_area_check CHECK (area IN ('ti', 'pam', 'educacion'))`
  );
  await add(
    `ALTER TABLE whatsapp_templates ADD CONSTRAINT whatsapp_templates_area_check CHECK (area IN ('ti', 'pam', 'educacion'))`
  );
  await add(
    `ALTER TABLE app_settings ADD CONSTRAINT app_settings_area_check CHECK (area IN ('ti', 'pam', 'educacion', 'global'))`
  );
}

/**
 * Limpia segmentos "clonados" automáticamente entre áreas para dejar cada una independiente.
 * Solo borra en áreas sin uso real (sin contactos ni campañas) y cuando coincide exactamente
 * con el set por defecto legacy.
 */
async function cleanUpCrossAreaSeededSegments(query) {
  const flag = `migration.cleanup_cross_area_segments_v1`;
  const done = await query(`SELECT 1 AS ok FROM app_settings WHERE area = 'global' AND key = $1`, [flag]);
  if (done.rows.length > 0) return;

  const defaultSlugs = ['suscriptor_1', 'suscriptor_2', 'suscriptor_3', 'asociado'];
  for (const area of ['pam', 'educacion']) {
    const seg = await query(
      `SELECT slug FROM segment_definitions WHERE area = $1 ORDER BY slug ASC`,
      [area]
    );
    const slugs = seg.rows.map((r) => String(r.slug || '').trim());
    const isDefaultSet =
      slugs.length === defaultSlugs.length &&
      slugs.every((slug, idx) => slug === [...defaultSlugs].sort()[idx]);
    if (!isDefaultSet) continue;

    const [contactsCount, campaignsCount] = await Promise.all([
      query(`SELECT COUNT(*)::int AS n FROM contacts WHERE area = $1`, [area]),
      query(`SELECT COUNT(*)::int AS n FROM campaigns WHERE area = $1`, [area]),
    ]);
    const hasUsage =
      Number(contactsCount.rows[0]?.n || 0) > 0 || Number(campaignsCount.rows[0]?.n || 0) > 0;
    if (hasUsage) continue;

    await query(`DELETE FROM segment_definitions WHERE area = $1`, [area]);
  }

  await query(
    `INSERT INTO app_settings (area, key, value, updated_at) VALUES ('global', $1, '1', NOW())
     ON CONFLICT (area, key) DO UPDATE SET value = '1', updated_at = NOW()`,
    [flag]
  );
}

/** Una sola vez: PAM y Educación con IA desactivada por defecto (solo TI dev con enabled true en semilla antigua). */
async function migrateAiTiOnlyEnabled(query) {
  const flag = 'migration.ai_ti_only_enabled_v1';
  const done = await query(`SELECT 1 AS ok FROM app_settings WHERE area = 'global' AND key = $1`, [flag]);
  if (done.rows.length > 0) {
    return;
  }
  const { parseAiConfigValue } = require('../utils/aiConfig');
  for (const area of ['pam', 'educacion']) {
    const r = await query(`SELECT value FROM app_settings WHERE area = $1 AND key = 'ai_config'`, [area]);
    const cfg = parseAiConfigValue(r.rows[0]?.value);
    if (cfg) {
      cfg.enabled = false;
      await query(
        `UPDATE app_settings SET value = $2, updated_at = NOW() WHERE area = $1 AND key = 'ai_config'`,
        [area, JSON.stringify(cfg)]
      );
    }
  }
  await query(
    `INSERT INTO app_settings (area, key, value, updated_at) VALUES ('global', $1, '1', NOW())
     ON CONFLICT (area, key) DO UPDATE SET value = '1', updated_at = NOW()`,
    [flag]
  );
}

module.exports = { runMigrations };
