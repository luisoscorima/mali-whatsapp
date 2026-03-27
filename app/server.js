require('dotenv').config();

const express = require('express');
const path = require('path');
const axios = require('axios');
const { Pool } = require('pg');
const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { parse: parseCsv } = require('csv-parse/sync');

const app = express();
const port = Number(process.env.PORT || 3000);
const nodeEnv = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const isProduction = nodeEnv === 'production';
const requireWebhookSignature = String(
  process.env.REQUIRE_WEBHOOK_SIGNATURE || (isProduction ? 'true' : 'false')
).trim().toLowerCase() === 'true';
const requireAuth = String(process.env.REQUIRE_AUTH || (isProduction ? 'true' : 'false'))
  .trim()
  .toLowerCase() === 'true';
const basicAuthUser = String(process.env.BASIC_AUTH_USER || '').trim();
const basicAuthPass = String(process.env.BASIC_AUTH_PASS || '').trim();
const allowedSegments = new Set(['suscriptor_1', 'suscriptor_2', 'suscriptor_3', 'asociado']);
const allowedLanguageCodeRegex = /^[a-z]{2}(?:_[A-Z]{2})?$/;
const allowedTemplateNameRegex = /^[a-z0-9_]{1,128}$/;
const e164NoPlusRegex = /^[1-9][0-9]{7,14}$/;
const MAX_NAME_LEN = 120;
const MAX_BODY_PARAM_LEN = 1024;
const MAX_TEMPLATE_BODY_VARS = 20;
const MAX_IMAGE_URL_LEN = 2048;
const MAX_BATCH_SIZE = 100;
const MAX_BATCH_DELAY_MS = 60000;
const MAX_CSV_ROWS = 10000;
const MAX_CSV_BYTES = 5 * 1024 * 1024;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(
  helmet({
    contentSecurityPolicy: false,
  })
);
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_MAX || 300),
  standardHeaders: true,
  legacyHeaders: false,
});

const campaignLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.CAMPAIGN_RATE_LIMIT_MAX || 5),
  standardHeaders: true,
  legacyHeaders: false,
});

const contactsImportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.CONTACTS_IMPORT_RATE_MAX || 30),
  standardHeaders: true,
  legacyHeaders: false,
});

const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_CSV_BYTES },
  fileFilter: (req, file, cb) => {
    const name = String(file.originalname || '').toLowerCase();
    if (name.endsWith('.csv')) {
      return cb(null, true);
    }
    cb(new Error('Solo archivos .csv'));
  },
});

app.use(globalLimiter);

function getRequestId(req) {
  return req.get('x-request-id') || crypto.randomUUID();
}

function logInfo(req, message, meta = {}) {
  console.log(
    JSON.stringify({
      level: 'info',
      message,
      requestId: getRequestId(req),
      path: req.path,
      method: req.method,
      ...meta,
    })
  );
}

function logError(req, message, error, meta = {}) {
  console.error(
    JSON.stringify({
      level: 'error',
      message,
      requestId: getRequestId(req),
      path: req.path,
      method: req.method,
      error: error?.message || String(error),
      status: error?.response?.status,
      metaResponse: error?.response?.data || null,
      ...meta,
    })
  );
}

function isProtectedPath(pathname) {
  if (pathname === '/health') {
    return false;
  }
  if (pathname === '/webhook') {
    return false;
  }
  return true;
}

function requireBasicAuth(req, res, next) {
  if (!requireAuth) {
    return next();
  }
  if (!basicAuthUser || !basicAuthPass) {
    return res.status(500).send('Auth habilitada pero faltan BASIC_AUTH_USER/BASIC_AUTH_PASS');
  }

  const authHeader = req.get('authorization') || '';
  if (!authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="MALI WhatsApp"');
    return res.status(401).send('Autenticacion requerida');
  }

  const encoded = authHeader.slice('Basic '.length);
  let decoded = '';
  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return res.status(401).send('Credenciales invalidas');
  }

  const separatorIndex = decoded.indexOf(':');
  if (separatorIndex < 0) {
    return res.status(401).send('Credenciales invalidas');
  }

  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);
  const userBuffer = Buffer.from(user);
  const expectedUserBuffer = Buffer.from(basicAuthUser);
  const passBuffer = Buffer.from(pass);
  const expectedPassBuffer = Buffer.from(basicAuthPass);

  const userOk =
    userBuffer.length === expectedUserBuffer.length &&
    crypto.timingSafeEqual(userBuffer, expectedUserBuffer);
  const passOk =
    passBuffer.length === expectedPassBuffer.length &&
    crypto.timingSafeEqual(passBuffer, expectedPassBuffer);

  if (!userOk || !passOk) {
    return res.status(401).send('Credenciales invalidas');
  }

  return next();
}

app.use((req, res, next) => {
  if (isProtectedPath(req.path)) {
    return requireBasicAuth(req, res, next);
  }
  return next();
});

function normalizePhone(phone) {
  return String(phone || '').replace(/\D/g, '');
}

function validateSegment(segment) {
  return allowedSegments.has(String(segment || ''));
}

function validateContactInput({ name, phone, segment }) {
  const normalizedName = String(name || '').trim();
  const normalizedPhone = normalizePhone(phone);
  const normalizedSegment = String(segment || '').trim();

  if (!normalizedName || normalizedName.length > MAX_NAME_LEN) {
    return { ok: false, message: `Nombre invalido (1-${MAX_NAME_LEN} caracteres)` };
  }
  if (!e164NoPlusRegex.test(normalizedPhone)) {
    return { ok: false, message: 'Telefono invalido. Usa formato E.164 sin +' };
  }
  if (!validateSegment(normalizedSegment)) {
    return { ok: false, message: 'Segmento invalido' };
  }

  return {
    ok: true,
    value: {
      name: normalizedName,
      phone: normalizedPhone,
      segment: normalizedSegment,
    },
  };
}

function pickContactFieldsFromRecord(record) {
  const r = {};
  for (const [k, v] of Object.entries(record)) {
    const key = String(k || '')
      .toLowerCase()
      .trim()
      .replace(/^\uFEFF/, '');
    r[key] = v;
  }
  const name = r.name ?? r.nombre ?? r['nombre completo'];
  const phone = r.phone ?? r.telefono ?? r.tel ?? r['teléfono'] ?? r.telefono_movil;
  const segment = r.segment ?? r.segmento;
  return { name, phone, segment };
}

function parseContactCsvBuffer(buffer) {
  const text = buffer.toString('utf8');
  const records = parseCsv(text, {
    columns: (header) =>
      header.map((h) =>
        String(h || '')
          .toLowerCase()
          .trim()
          .replace(/^\uFEFF/, '')
      ),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  });
  const rows = [];
  const errors = [];
  for (let i = 0; i < records.length; i++) {
    const picked = pickContactFieldsFromRecord(records[i]);
    const v = validateContactInput(picked);
    if (!v.ok) {
      errors.push({ line: i + 2, message: v.message });
      continue;
    }
    rows.push(v.value);
  }
  const byPhone = new Map();
  for (const row of rows) {
    byPhone.set(row.phone, row);
  }
  return { rows: [...byPhone.values()], errors };
}

function sanitizeApiResponse(data) {
  return {
    messaging_product: data?.messaging_product,
    contacts: Array.isArray(data?.contacts) ? data.contacts : [],
    messages: Array.isArray(data?.messages)
      ? data.messages.map((item) => ({ id: item.id, message_status: item.message_status }))
      : [],
  };
}

function sanitizeApiErrorPayload(payload) {
  const error = payload?.error || {};
  return {
    error: {
      message: error.message || payload?.message || 'unknown_error',
      type: error.type,
      code: error.code,
      error_subcode: error.error_subcode,
      fbtrace_id: error.fbtrace_id,
    },
  };
}

let settingsCache = null;
let settingsCacheAt = 0;
const SETTINGS_CACHE_TTL_MS = 2000;

async function ensureAppSettingsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
  `);
}

function invalidateSettingsCache() {
  settingsCache = null;
  settingsCacheAt = 0;
}

async function loadAppSettings() {
  const now = Date.now();
  if (settingsCache && now - settingsCacheAt < SETTINGS_CACHE_TTL_MS) {
    return settingsCache;
  }
  await ensureAppSettingsTable();
  const result = await query('SELECT key, value FROM app_settings');
  const map = {};
  for (const row of result.rows) {
    map[row.key] = row.value;
  }
  settingsCache = map;
  settingsCacheAt = now;
  return map;
}

function isSettingStored(map, key) {
  return map && Object.prototype.hasOwnProperty.call(map, key) && String(map[key]).trim() !== '';
}

function buildTemplateBodyConfigFromMap(map) {
  const countRaw = isSettingStored(map, 'template_body_variable_count')
    ? map.template_body_variable_count
    : process.env.TEMPLATE_BODY_VARIABLE_COUNT;
  const totalCount = Math.min(
    MAX_TEMPLATE_BODY_VARS,
    Math.max(0, Number(countRaw || 4))
  );
  const firstRaw = isSettingStored(map, 'template_body_variable_1_from_contact')
    ? map.template_body_variable_1_from_contact
    : process.env.TEMPLATE_BODY_VARIABLE_1_FROM_CONTACT;
  const firstFromContact = String(firstRaw || 'false').trim().toLowerCase() === 'true';
  const labelsRaw = String(
    isSettingStored(map, 'template_body_variable_labels')
      ? map.template_body_variable_labels
      : process.env.TEMPLATE_BODY_VARIABLE_LABELS || ''
  ).trim();
  const labels = labelsRaw
    ? labelsRaw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const formSlotCount = Math.max(0, totalCount - (firstFromContact ? 1 : 0));
  return { totalCount, firstFromContact, labels, formSlotCount };
}

function buildTemplatesWithoutSetFromMap(map) {
  if (isSettingStored(map, 'templates_without_components')) {
    return new Set(
      String(map.templates_without_components)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
  }
  return new Set(
    String(process.env.TEMPLATES_WITHOUT_COMPONENTS || 'hello_world')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  );
}

function isTemplateWithoutComponents(templateName, templatesWithoutSet) {
  return templatesWithoutSet.has(String(templateName || '').trim());
}

function getTemplateSettingsFormValues(map) {
  const m = map || {};
  return {
    variableCount: isSettingStored(m, 'template_body_variable_count')
      ? m.template_body_variable_count
      : String(process.env.TEMPLATE_BODY_VARIABLE_COUNT || '4'),
    firstFromContact: isSettingStored(m, 'template_body_variable_1_from_contact')
      ? String(m.template_body_variable_1_from_contact).trim().toLowerCase() === 'true'
      : String(process.env.TEMPLATE_BODY_VARIABLE_1_FROM_CONTACT || 'false').trim().toLowerCase() ===
          'true',
    labels: isSettingStored(m, 'template_body_variable_labels')
      ? m.template_body_variable_labels
      : String(process.env.TEMPLATE_BODY_VARIABLE_LABELS || ''),
    templatesWithout: isSettingStored(m, 'templates_without_components')
      ? m.templates_without_components
      : '',
  };
}

function extractOrderedBodyParams(reqBody) {
  const keys = Object.keys(reqBody).filter((k) => /^bodyParam_\d+$/.test(k));
  keys.sort((a, b) => {
    const na = Number(a.replace('bodyParam_', ''));
    const nb = Number(b.replace('bodyParam_', ''));
    return na - nb;
  });
  return keys.map((k) => String(reqBody[k] ?? '').trim());
}

function buildBodyParamsForTemplate(contact, rawFormParams, cfg) {
  if (cfg.firstFromContact) {
    return [String(contact.name || '').trim(), ...rawFormParams];
  }
  return [...rawFormParams];
}

function getBodyParamUiForView(cfg) {
  const labels = [];
  for (let i = 0; i < cfg.formSlotCount; i++) {
    const varIndex = cfg.firstFromContact ? i + 2 : i + 1;
    labels.push(cfg.labels[i] || `Texto para {{${varIndex}}}`);
  }
  return {
    formSlotCount: cfg.formSlotCount,
    labels,
    firstFromContact: cfg.firstFromContact,
    totalBodyVars: cfg.totalCount,
  };
}

function validateCampaignInput(reqBody, bodyCfg, templatesWithoutSet) {
  const segment = String(reqBody.segment || '').trim();
  const templateName = String(reqBody.templateName || '').trim();
  const languageCode = String(
    reqBody.languageCode || process.env.DEFAULT_TEMPLATE_LANGUAGE || 'en_US'
  ).trim();
  const imageUrl = String(reqBody.imageUrl || '').trim();
  const batchSize = Number(reqBody.batchSize || process.env.DEFAULT_BATCH_SIZE || 40);
  const batchDelayMs = Number(reqBody.batchDelayMs || process.env.DEFAULT_BATCH_DELAY_MS || 1500);

  if (!validateSegment(segment)) {
    return { ok: false, message: 'Segmento invalido' };
  }
  if (!allowedTemplateNameRegex.test(templateName)) {
    return { ok: false, message: 'Nombre de plantilla invalido' };
  }
  if (!allowedLanguageCodeRegex.test(languageCode)) {
    return { ok: false, message: 'Codigo de idioma invalido' };
  }
  if (imageUrl && imageUrl.length > MAX_IMAGE_URL_LEN) {
    return { ok: false, message: `URL de imagen invalida (max ${MAX_IMAGE_URL_LEN})` };
  }
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    return { ok: false, message: `Batch size invalido (1-${MAX_BATCH_SIZE})` };
  }
  if (!Number.isInteger(batchDelayMs) || batchDelayMs < 0 || batchDelayMs > MAX_BATCH_DELAY_MS) {
    return { ok: false, message: `Batch delay invalido (0-${MAX_BATCH_DELAY_MS})` };
  }

  if (isTemplateWithoutComponents(templateName, templatesWithoutSet)) {
    return {
      ok: true,
      value: {
        segment,
        templateName,
        languageCode,
        rawBodyParams: [],
        bodyTemplateConfig: bodyCfg,
        templatesWithoutSet,
        messageText: '(plantilla sin variables de cuerpo)',
        imageUrl: imageUrl || null,
        batchSize,
        batchDelayMs,
      },
    };
  }

  const cfg = bodyCfg;
  if (cfg.totalCount === 0) {
    return {
      ok: false,
      message:
        'Numero de variables de plantilla es 0. Define la cantidad en Configuracion (o TEMPLATE_BODY_VARIABLE_COUNT en .env) o marca la plantilla como sin variables.',
    };
  }

  const rawBodyParams = extractOrderedBodyParams(reqBody);
  if (rawBodyParams.length !== cfg.formSlotCount) {
    return {
      ok: false,
      message: `Se esperaban ${cfg.formSlotCount} valores de plantilla (bodyParam_0 ...). Revisa el formulario.`,
    };
  }

  for (let i = 0; i < rawBodyParams.length; i++) {
    const v = rawBodyParams[i];
    if (!v || v.length > MAX_BODY_PARAM_LEN) {
      return {
        ok: false,
        message: `Parametro de plantilla ${i + 1} invalido (1-${MAX_BODY_PARAM_LEN} caracteres)`,
      };
    }
  }

  const messageText = rawBodyParams.join(' | ');

  return {
    ok: true,
    value: {
      segment,
      templateName,
      languageCode,
      rawBodyParams,
      bodyTemplateConfig: cfg,
      templatesWithoutSet,
      messageText,
      imageUrl: imageUrl || null,
      batchSize,
      batchDelayMs,
    },
  };
}

function verifyWebhookSignature(req) {
  const appSecret = process.env.APP_SECRET;
  const signature = req.get('x-hub-signature-256');

  if (requireWebhookSignature && !appSecret) {
    return false;
  }

  // Signature validation can be optional outside production.
  if (!appSecret) {
    return true;
  }

  if (!signature) {
    return !requireWebhookSignature;
  }

  const [prefix, signatureHash] = signature.split('=');
  if (prefix !== 'sha256' || !signatureHash) {
    return false;
  }

  const expectedHash = crypto
    .createHmac('sha256', appSecret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHash), Buffer.from(expectedHash));
  } catch {
    return false;
  }
}

const SEGMENTS = [
  { value: 'suscriptor_1', label: 'Suscriptor 1' },
  { value: 'suscriptor_2', label: 'Suscriptor 2' },
  { value: 'suscriptor_3', label: 'Suscriptor 3' },
  { value: 'asociado', label: 'Asociado' },
];

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function query(text, params = []) {
  const result = await pool.query(text, params);
  return result;
}

async function upsertSetting(key, value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    await query('DELETE FROM app_settings WHERE key = $1', [key]);
    return;
  }
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [key, String(value).trim()]
  );
}

async function saveTemplateSettingsFromBody(body) {
  let count = parseInt(String(body.template_body_variable_count ?? '4').trim(), 10);
  if (Number.isNaN(count)) count = 4;
  count = Math.min(MAX_TEMPLATE_BODY_VARS, Math.max(0, count));

  const firstFrom =
    body.template_body_variable_1_from_contact === '1' ||
    body.template_body_variable_1_from_contact === 'on' ||
    String(body.template_body_variable_1_from_contact || '').toLowerCase() === 'true';

  const labels = String(body.template_body_variable_labels ?? '').trim();
  const tw = String(body.templates_without_components ?? '').trim();

  await upsertSetting('template_body_variable_count', String(count));
  await query(
    `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    ['template_body_variable_1_from_contact', firstFrom ? 'true' : 'false']
  );
  await upsertSetting('template_body_variable_labels', labels);
  await upsertSetting('templates_without_components', tw);
  invalidateSettingsCache();
}

async function sendTemplateMessage({
  to,
  templateName,
  languageCode,
  imageUrl,
  bodyParams = [],
  templatesWithoutSet,
}) {
  const phoneNumberId = process.env.PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;

  const components = [];
  const skipComponents = templatesWithoutSet.has(templateName);

  if (!skipComponents && imageUrl) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: 'image',
          image: { link: imageUrl },
        },
      ],
    });
  }

  if (!skipComponents && bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams.map((text) => ({ type: 'text', text })),
    });
  }

  const payload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode || process.env.DEFAULT_TEMPLATE_LANGUAGE || 'en_US' },
      components,
    },
  };

  const response = await axios.post(
    `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    }
  );

  return response.data;
}

app.get('/', async (req, res) => {
  const [contactsResult, campaignsResult, statsResult] = await Promise.all([
    query(
      `SELECT id, name, phone, segment, opt_in, active, created_at
       FROM contacts
       ORDER BY id DESC
       LIMIT 10`
    ),
    query(
      `SELECT
        c.id,
        c.segment,
        c.template_name,
        c.message_text,
        c.image_url,
        c.status,
        c.total_recipients,
        c.created_at,
        COALESCE(SUM(CASE WHEN cl.status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS sent_count,
        COALESCE(SUM(CASE WHEN cl.status IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
        COALESCE(SUM(CASE WHEN cl.status = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
        COALESCE(SUM(CASE WHEN cl.status IN ('error', 'failed', 'undelivered') THEN 1 ELSE 0 END), 0)::int AS failed_count
       FROM campaigns c
       LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
       GROUP BY c.id
       ORDER BY c.id DESC
       LIMIT 10`
    ),
    query(
      `SELECT segment, COUNT(*)::int AS total
       FROM contacts
       WHERE active = TRUE
       GROUP BY segment
       ORDER BY segment`
    ),
  ]);

  const settingsMap = await loadAppSettings();
  const bodyCfg = buildTemplateBodyConfigFromMap(settingsMap);

  res.render('dashboard', {
    segments: SEGMENTS,
    contacts: contactsResult.rows,
    campaigns: campaignsResult.rows,
    stats: statsResult.rows,
    defaults: {
      templateName: process.env.DEFAULT_TEMPLATE_NAME || 'mali_novedades_generales',
      templateLanguage: process.env.DEFAULT_TEMPLATE_LANGUAGE || 'en_US',
    },
    bodyParamUi: getBodyParamUiForView(bodyCfg),
    templateSettingsForm: getTemplateSettingsFormValues(settingsMap),
    settingsSaved: String(req.query.settings_saved || '') === '1',
    csvImport:
      String(req.query.contacts_import || '') === '1'
        ? {
            ok: req.query.ok !== undefined ? Number(req.query.ok) : null,
            bad: req.query.bad !== undefined ? Number(req.query.bad) : null,
            err: req.query.err || null,
          }
        : null,
    maxCsvRows: MAX_CSV_ROWS,
    appBaseUrl: process.env.APP_BASE_URL || `http://localhost:${port}`,
  });
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const [contactsResult, campaignsResult, statsResult] = await Promise.all([
      query(
        `SELECT id, name, phone, segment, opt_in, active, created_at
         FROM contacts
         ORDER BY id DESC
         LIMIT 25`
      ),
      query(
        `SELECT
           c.id,
           c.segment,
           c.template_name,
           c.status,
           c.total_recipients,
           c.created_at,
           COALESCE(SUM(CASE WHEN cl.status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS sent_count,
           COALESCE(SUM(CASE WHEN cl.status IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
           COALESCE(SUM(CASE WHEN cl.status = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
           COALESCE(SUM(CASE WHEN cl.status IN ('error', 'failed', 'undelivered') THEN 1 ELSE 0 END), 0)::int AS failed_count
         FROM campaigns c
         LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
         GROUP BY c.id
         ORDER BY c.id DESC
         LIMIT 25`
      ),
      query(
        `SELECT segment, COUNT(*)::int AS total
         FROM contacts
         WHERE active = TRUE
         GROUP BY segment
         ORDER BY segment`
      ),
    ]);

    res.json({
      ok: true,
      contacts: contactsResult.rows,
      campaigns: campaignsResult.rows,
      stats: statsResult.rows,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/health', async (req, res) => {
  try {
    await query('SELECT 1');
    res.json({ ok: true, db: 'up' });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/contacts/sample.csv', (req, res) => {
  const sample = [
    'name,phone,segment',
    'Ejemplo Usuario,51999999999,suscriptor_1',
    'Maria Ejemplo,51988888888,suscriptor_2',
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="contactos_ejemplo.csv"');
  res.send(`${sample}\n`);
});

app.post('/contacts', async (req, res) => {
  const validation = validateContactInput(req.body);
  if (!validation.ok) {
    return res.status(400).send(validation.message);
  }

  try {
    await query(
      `INSERT INTO contacts (name, phone, segment, opt_in, active)
       VALUES ($1, $2, $3, TRUE, TRUE)`,
      [validation.value.name, validation.value.phone, validation.value.segment]
    );
    logInfo(req, 'Contacto creado', { phone: validation.value.phone, segment: validation.value.segment });
    res.redirect('/');
  } catch (error) {
    logError(req, 'Error al crear contacto', error);
    res.status(400).send(`No se pudo guardar el contacto: ${error.message}`);
  }
});

app.post(
  '/contacts/import',
  contactsImportLimiter,
  (req, res, next) => {
    csvUpload.single('csvfile')(req, res, (err) => {
      if (err) {
        if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
          return res.redirect('/?contacts_import=1&err=too_big');
        }
        return res.redirect('/?contacts_import=1&err=type');
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.file || !req.file.buffer.length) {
      return res.redirect('/?contacts_import=1&err=no_file');
    }

    try {
      const { rows, errors } = parseContactCsvBuffer(req.file.buffer);

      if (rows.length > MAX_CSV_ROWS) {
        return res.redirect('/?contacts_import=1&err=too_many');
      }

      if (rows.length === 0 && errors.length === 0) {
        return res.redirect('/?contacts_import=1&err=empty');
      }

      if (rows.length === 0) {
        const qp = new URLSearchParams({
          contacts_import: '1',
          ok: '0',
          bad: String(errors.length),
        });
        return res.redirect(`/?${qp.toString()}`);
      }

      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (const row of rows) {
          await client.query(
            `INSERT INTO contacts (name, phone, segment, opt_in, active)
             VALUES ($1, $2, $3, TRUE, TRUE)
             ON CONFLICT (phone) DO UPDATE SET
               name = EXCLUDED.name,
               segment = EXCLUDED.segment,
               updated_at = NOW()`,
            [row.name, row.phone, row.segment]
          );
        }
        await client.query('COMMIT');
      } catch (dbErr) {
        await client.query('ROLLBACK');
        throw dbErr;
      } finally {
        client.release();
      }

      const qp = new URLSearchParams({
        contacts_import: '1',
        ok: String(rows.length),
        bad: String(errors.length),
      });
      res.redirect(`/?${qp.toString()}`);
      logInfo(req, 'Importacion CSV contactos', {
        imported: rows.length,
        rowErrors: errors.length,
      });
    } catch (error) {
      logError(req, 'Error importando CSV', error);
      res.redirect('/?contacts_import=1&err=parse');
    }
  }
);

app.post('/settings', async (req, res) => {
  try {
    await saveTemplateSettingsFromBody(req.body);
    logInfo(req, 'Configuracion de plantilla guardada');
    res.redirect('/?settings_saved=1');
  } catch (error) {
    logError(req, 'Error guardando configuracion', error);
    res.status(500).send(`No se pudo guardar la configuracion: ${error.message}`);
  }
});

app.post('/campaigns/send', campaignLimiter, async (req, res) => {
  const settingsMap = await loadAppSettings();
  const bodyCfg = buildTemplateBodyConfigFromMap(settingsMap);
  const templatesWithoutSet = buildTemplatesWithoutSetFromMap(settingsMap);

  const validation = validateCampaignInput(req.body, bodyCfg, templatesWithoutSet);
  if (!validation.ok) {
    return res.status(400).send(validation.message);
  }

  const {
    segment,
    templateName,
    languageCode,
    rawBodyParams,
    bodyTemplateConfig,
    templatesWithoutSet: tws,
    messageText,
    imageUrl,
    batchSize,
    batchDelayMs,
  } = validation.value;

  try {
    const recipientsResult = await query(
      `SELECT id, name, phone
       FROM contacts
       WHERE segment = $1
         AND opt_in = TRUE
         AND active = TRUE
       ORDER BY id ASC`,
      [segment]
    );

    const recipients = recipientsResult.rows;

    const campaignResult = await query(
      `INSERT INTO campaigns (segment, template_name, message_text, image_url, status, total_recipients)
       VALUES ($1, $2, $3, $4, 'processing', $5)
       RETURNING id`,
      [segment, templateName, messageText, imageUrl, recipients.length]
    );

    const campaignId = campaignResult.rows[0].id;

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      for (const contact of batch) {
        try {
          const apiResponse = await sendTemplateMessage({
            to: normalizePhone(contact.phone),
            templateName,
            languageCode,
            imageUrl,
            bodyParams: buildBodyParamsForTemplate(contact, rawBodyParams, bodyTemplateConfig),
            templatesWithoutSet: tws,
          });

          const messageId = apiResponse.messages?.[0]?.id || null;

          await query(
            `INSERT INTO campaign_logs (campaign_id, contact_id, phone, whatsapp_message_id, status, response)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              campaignId,
              contact.id,
              normalizePhone(contact.phone),
              messageId,
              'sent',
              JSON.stringify(sanitizeApiResponse(apiResponse)),
            ]
          );
        } catch (error) {
          const payload = sanitizeApiErrorPayload(error.response?.data || { message: error.message });

          await query(
            `INSERT INTO campaign_logs (campaign_id, contact_id, phone, status, response)
             VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [campaignId, contact.id, normalizePhone(contact.phone), 'error', JSON.stringify(payload)]
          );
          logError(req, 'Error enviando mensaje', error, { campaignId, contactId: contact.id });
        }
      }

      if (i + batchSize < recipients.length) {
        await wait(batchDelayMs);
      }
    }

    await query(`UPDATE campaigns SET status = 'completed' WHERE id = $1`, [campaignId]);
    logInfo(req, 'Campana completada', { campaignId, recipients: recipients.length });

    res.redirect(`/campaigns/${campaignId}`);
  } catch (error) {
    logError(req, 'Error en envio de campana', error);
    res.status(500).send(`No se pudo enviar la campaña: ${error.message}`);
  }
});

app.get('/campaigns/:id', async (req, res) => {
  const campaignId = Number(req.params.id);
  if (!Number.isInteger(campaignId) || campaignId <= 0) {
    return res.status(400).send('Id de campana invalido');
  }

  const [campaignResult, logsResult] = await Promise.all([
    query(`SELECT * FROM campaigns WHERE id = $1`, [campaignId]),
    query(
      `SELECT id, phone, whatsapp_message_id, status, response, created_at
       FROM campaign_logs
       WHERE campaign_id = $1
       ORDER BY id DESC`,
      [campaignId]
    ),
  ]);

  if (campaignResult.rowCount === 0) {
    return res.status(404).send('Campaña no encontrada');
  }

  res.render('campaign-detail', {
    campaign: campaignResult.rows[0],
    logs: logsResult.rows,
  });
});

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    if (!verifyWebhookSignature(req)) {
      return res.status(401).json({ ok: false, error: 'Invalid webhook signature' });
    }

    const entries = req.body.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];

      for (const change of changes) {
        const statuses = change.value?.statuses || [];

        for (const status of statuses) {
          const messageId = status.id;
          const mappedStatus = status.status;

          if (messageId && mappedStatus) {
            await query(
              `UPDATE campaign_logs
               SET status = $1,
                   response = COALESCE(response, '{}'::jsonb) || $2::jsonb
               WHERE whatsapp_message_id = $3`,
              [mappedStatus, JSON.stringify(status), messageId]
            );
          }
        }
      }
    }

    res.sendStatus(200);
  } catch (error) {
    logError(req, 'Error procesando webhook', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

async function boot() {
  await ensureAppSettingsTable();
  app.listen(port, '0.0.0.0', () => {
    console.log(`Servidor listo en puerto ${port}`);
  });
}

boot().catch((err) => {
  console.error(err);
  process.exit(1);
});
