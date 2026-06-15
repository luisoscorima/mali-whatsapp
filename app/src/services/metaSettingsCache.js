/**
 * Credenciales Meta: valores en app_settings (clave meta.*) con fallback a process.env.
 * Caché en memoria refrescada al arrancar y tras guardar en /admin/meta.
 *
 * Áreas: ti, pam, patronato, educacion.
 */

const config = require('../config');

const KEYS = {
  verifyToken: 'meta.verify_token',
  appSecret: 'meta.app_secret',
  whatsappToken: 'meta.whatsapp_token',
  phoneNumberId: 'meta.phone_number_id',
  wabaId: 'meta.waba_id',
};

const VALID_META_AREAS = config.BUSINESS_AREAS;

const ENV_BY_AREA = {
  ti: {
    token: 'WHATSAPP_TOKEN_TI',
    phone: 'PHONE_NUMBER_ID_TI',
    waba: 'WABA_ID_TI',
  },
  pam: {
    token: 'WHATSAPP_TOKEN_PAM',
    phone: 'PHONE_NUMBER_ID_PAM',
    waba: 'WABA_ID_PAM',
  },
  patronato: {
    token: 'WHATSAPP_TOKEN_PATRONATO',
    phone: 'PHONE_NUMBER_ID_PATRONATO',
    waba: 'WABA_ID_PATRONATO',
  },
  educacion: {
    token: 'WHATSAPP_TOKEN_EDUCACION',
    phone: 'PHONE_NUMBER_ID_EDUCACION',
    waba: 'WABA_ID_EDUCACION',
  },
};

function emptyAreaCache() {
  const empty = { global: {} };
  for (const area of VALID_META_AREAS) {
    empty[area] = {};
  }
  return empty;
}

let cache = emptyAreaCache();

/** Evita spam en logs al corregir Phone Number ID duplicado con TI. */
const warnedPhoneIdDupWithTi = new Set();

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

function normalizeCredentialArea(area) {
  const a = String(area || '').trim().toLowerCase();
  if (VALID_META_AREAS.includes(a)) return a;
  return 'ti';
}

async function refreshMetaSettingsCache(queryFn) {
  const empty = emptyAreaCache();
  try {
    const r = await queryFn(
      `SELECT area, key, value FROM app_settings WHERE key LIKE 'meta.%'`
    );
    for (const row of r.rows) {
      const a = String(row.area || '').trim();
      if (a === 'global' || VALID_META_AREAS.includes(a)) {
        empty[a][row.key] = row.value;
      }
    }
  } catch {
    /* sin tabla o error: seguir con env */
  }
  cache = empty;
  warnedPhoneIdDupWithTi.clear();
}

function getVerifyToken() {
  return normalizeSecretValue(cache.global[KEYS.verifyToken] || process.env.VERIFY_TOKEN || '');
}

function getAppSecret() {
  return normalizeSecretValue(cache.global[KEYS.appSecret] || process.env.APP_SECRET || '');
}

/**
 * Resuelve token + phone_number_id desde app_settings y .env (sin corrección de duplicados).
 */
function buildWhatsAppCredentialsRaw(norm) {
  const row = cache[norm] || {};
  let token = normalizeSecretValue(row[KEYS.whatsappToken] || '');
  let phoneNumberId = String(row[KEYS.phoneNumberId] || '').trim();

  const fallbackToken = normalizeSecretValue(process.env.WHATSAPP_TOKEN || '');
  const fallbackPhone = String(process.env.PHONE_NUMBER_ID || '').trim();
  const envKeys = ENV_BY_AREA[norm] || ENV_BY_AREA.ti;

  if (!token) {
    token = normalizeSecretValue(process.env[envKeys.token] || fallbackToken);
  }

  if (!phoneNumberId) {
    phoneNumberId = String(process.env[envKeys.phone] || fallbackPhone).trim();
  }

  return { token, phoneNumberId };
}

/** Token + Phone Number ID de la línea que coincide con un ID de Meta (todas las áreas). */
function getCredentialsForPhoneNumberId(phoneNumberId) {
  const pid = String(phoneNumberId || '').trim();
  if (!pid) return null;
  for (const area of VALID_META_AREAS) {
    const creds = getWhatsAppCredentialsForArea(area);
    if (String(creds.phoneNumberId || '').trim() === pid) {
      return { ...creds, area };
    }
  }
  return null;
}

/**
 * Credenciales para enviar: si hay phone_number_id de línea, usa esa; si no, el área.
 */
function resolveWhatsAppSendCredentials({ area, phoneNumberId } = {}) {
  const pidOverride = String(phoneNumberId || '').trim();
  if (pidOverride) {
    const byLine = getCredentialsForPhoneNumberId(pidOverride);
    if (!byLine?.token || !byLine?.phoneNumberId) {
      throw new Error(`Linea WhatsApp no configurada para phone_number_id ${pidOverride}`);
    }
    return byLine;
  }
  const creds = getWhatsAppCredentialsForArea(area);
  if (!creds.token || !creds.phoneNumberId) {
    throw new Error(
      'Faltan credenciales WhatsApp para esta area: define WHATSAPP_TOKEN_TI/PAM/EDUCACION y PHONE_NUMBER_ID_* (o WHATSAPP_TOKEN/PHONE_NUMBER_ID como respaldo)'
    );
  }
  return creds;
}

function getWhatsAppCredentialsForArea(area) {
  const norm = normalizeCredentialArea(area);
  let { token, phoneNumberId } = buildWhatsAppCredentialsRaw(norm);

  /**
   * Si en app_settings un área distinta de TI tiene el mismo Phone Number ID que TI
   * (error típico al copiar credenciales en Admin), preferimos el .env del área.
   */
  if (norm !== 'ti') {
    const tiPid = String(buildWhatsAppCredentialsRaw('ti').phoneNumberId || '').trim();
    const pid = String(phoneNumberId || '').trim();
    if (tiPid && pid && pid === tiPid) {
      const fallbackPhone = String(process.env.PHONE_NUMBER_ID || '').trim();
      const envKeys = ENV_BY_AREA[norm] || {};
      const preferred = String(process.env[envKeys.phone] || fallbackPhone).trim();
      if (preferred && preferred !== pid) {
        if (!warnedPhoneIdDupWithTi.has(norm)) {
          warnedPhoneIdDupWithTi.add(norm);
          console.warn(
            JSON.stringify({
              level: 'warn',
              message:
                'Credenciales Meta: Phone Number ID en app_settings para este area coincide con TI; se usa el PHONE_NUMBER_ID_* del entorno del area',
              area: norm,
            })
          );
        }
        phoneNumberId = preferred;
      }
    }
  }

  return { token, phoneNumberId, area: norm };
}

function getWabaIdOverrideForArea(area) {
  const norm = normalizeCredentialArea(area);
  const row = cache[norm];
  const fromDb = String(row[KEYS.wabaId] || '').trim();
  if (fromDb) return fromDb;
  const fallbackWaba = String(process.env.WABA_ID || '').trim();
  const envKeys = ENV_BY_AREA[norm] || ENV_BY_AREA.ti;
  return String(process.env[envKeys.waba] || fallbackWaba).trim();
}

module.exports = {
  refreshMetaSettingsCache,
  getVerifyToken,
  getAppSecret,
  getWhatsAppCredentialsForArea,
  getCredentialsForPhoneNumberId,
  resolveWhatsAppSendCredentials,
  getWabaIdOverrideForArea,
  KEYS,
  normalizeSecretValue,
  normalizeCredentialArea,
  VALID_META_AREAS,
};
