/**
 * Credenciales Meta: valores en app_settings (clave meta.*) con fallback a process.env.
 * Caché en memoria refrescada al arrancar y tras guardar en /admin/meta.
 */

let cache = {
  global: {},
  pam: {},
  educacion: {},
};

const KEYS = {
  verifyToken: 'meta.verify_token',
  appSecret: 'meta.app_secret',
  whatsappToken: 'meta.whatsapp_token',
  phoneNumberId: 'meta.phone_number_id',
  wabaId: 'meta.waba_id',
};

/** Quita BOM, espacios y comillas envolventes típicas de .env mal copiado. */
function normalizeSecretValue(s) {
  let v = String(s ?? '')
    .replace(/^\uFEFF/, '')
    .trim();
  if (
    (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
    (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
  ) {
    v = v.slice(1, -1).trim();
  }
  return v;
}

async function refreshMetaSettingsCache(queryFn) {
  const empty = { global: {}, pam: {}, educacion: {} };
  try {
    const r = await queryFn(
      `SELECT area, key, value FROM app_settings WHERE key LIKE 'meta.%'`
    );
    for (const row of r.rows) {
      const a = String(row.area || '').trim();
      if (a === 'global' || a === 'pam' || a === 'educacion') {
        empty[a][row.key] = row.value;
      }
    }
  } catch {
    /* sin tabla o error: seguir con env */
  }
  cache = empty;
}

function getVerifyToken() {
  return normalizeSecretValue(cache.global[KEYS.verifyToken] || process.env.VERIFY_TOKEN || '');
}

function getAppSecret() {
  return normalizeSecretValue(cache.global[KEYS.appSecret] || process.env.APP_SECRET || '');
}

function getWhatsAppCredentialsForArea(area) {
  const norm = String(area || '').trim().toLowerCase() === 'educacion' ? 'educacion' : 'pam';
  const row = cache[norm];
  const token =
    normalizeSecretValue(row[KEYS.whatsappToken] || '') ||
    (norm === 'educacion'
      ? normalizeSecretValue(process.env.WHATSAPP_TOKEN_EDUCACION || process.env.WHATSAPP_TOKEN || '')
      : normalizeSecretValue(process.env.WHATSAPP_TOKEN_PAM || process.env.WHATSAPP_TOKEN || ''));
  const phoneNumberId =
    String(row[KEYS.phoneNumberId] || '').trim() ||
    (norm === 'educacion'
      ? String(process.env.PHONE_NUMBER_ID_EDUCACION || process.env.PHONE_NUMBER_ID || '').trim()
      : String(process.env.PHONE_NUMBER_ID_PAM || process.env.PHONE_NUMBER_ID || '').trim());
  return { token, phoneNumberId, area: norm };
}

function getWabaIdOverrideForArea(area) {
  const norm = String(area || '').trim().toLowerCase() === 'educacion' ? 'educacion' : 'pam';
  const row = cache[norm];
  const fromDb = String(row[KEYS.wabaId] || '').trim();
  if (fromDb) return fromDb;
  if (norm === 'educacion') {
    return String(process.env.WABA_ID_EDUCACION || '').trim();
  }
  return String(process.env.WABA_ID_PAM || '').trim();
}

module.exports = {
  refreshMetaSettingsCache,
  getVerifyToken,
  getAppSecret,
  getWhatsAppCredentialsForArea,
  getWabaIdOverrideForArea,
  KEYS,
  normalizeSecretValue,
};
