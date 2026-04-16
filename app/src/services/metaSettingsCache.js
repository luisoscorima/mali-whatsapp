/**
 * Credenciales Meta: valores en app_settings (clave meta.*) con fallback a process.env.
 * Caché en memoria refrescada al arrancar y tras guardar en /admin/meta.
 *
 * Áreas: ti (TI dev), pam (PAM), educacion (Educación).
 */

let cache = {
  global: {},
  ti: {},
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

const VALID_META_AREAS = ['ti', 'pam', 'educacion'];

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
  if (a === 'educacion') return 'educacion';
  if (a === 'pam') return 'pam';
  if (a === 'ti') return 'ti';
  return 'ti';
}

async function refreshMetaSettingsCache(queryFn) {
  const empty = { global: {}, ti: {}, pam: {}, educacion: {} };
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

  if (!token) {
    if (norm === 'ti') {
      token = normalizeSecretValue(process.env.WHATSAPP_TOKEN_TI || fallbackToken);
    } else if (norm === 'pam') {
      token = normalizeSecretValue(process.env.WHATSAPP_TOKEN_PAM || fallbackToken);
    } else {
      token = normalizeSecretValue(process.env.WHATSAPP_TOKEN_EDUCACION || fallbackToken);
    }
  }

  if (!phoneNumberId) {
    if (norm === 'ti') {
      phoneNumberId = String(process.env.PHONE_NUMBER_ID_TI || fallbackPhone).trim();
    } else if (norm === 'pam') {
      phoneNumberId = String(process.env.PHONE_NUMBER_ID_PAM || fallbackPhone).trim();
    } else {
      phoneNumberId = String(process.env.PHONE_NUMBER_ID_EDUCACION || fallbackPhone).trim();
    }
  }

  return { token, phoneNumberId };
}

function getWhatsAppCredentialsForArea(area) {
  const norm = normalizeCredentialArea(area);
  let { token, phoneNumberId } = buildWhatsAppCredentialsRaw(norm);

  /**
   * Si en app_settings el área pam/educacion tiene el mismo Phone Number ID que TI
   * (error típico al copiar credenciales en Admin), la API de Meta envía con la línea TI
   * y el webhook trae metadata.phone_number_id de TI. Si .env tiene un ID distinto para
   * ese área, preferimos el entorno.
   */
  if (norm !== 'ti') {
    const tiPid = String(buildWhatsAppCredentialsRaw('ti').phoneNumberId || '').trim();
    const pid = String(phoneNumberId || '').trim();
    if (tiPid && pid && pid === tiPid) {
      const fallbackPhone = String(process.env.PHONE_NUMBER_ID || '').trim();
      const preferred =
        norm === 'pam'
          ? String(process.env.PHONE_NUMBER_ID_PAM || fallbackPhone).trim()
          : String(process.env.PHONE_NUMBER_ID_EDUCACION || fallbackPhone).trim();
      if (preferred && preferred !== pid) {
        if (!warnedPhoneIdDupWithTi.has(norm)) {
          warnedPhoneIdDupWithTi.add(norm);
          console.warn(
            JSON.stringify({
              level: 'warn',
              message:
                'Credenciales Meta: Phone Number ID en app_settings para este area coincide con TI; se usa PHONE_NUMBER_ID_PAM o PHONE_NUMBER_ID_EDUCACION del entorno',
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
  if (norm === 'ti') {
    return String(process.env.WABA_ID_TI || fallbackWaba).trim();
  }
  if (norm === 'pam') {
    return String(process.env.WABA_ID_PAM || fallbackWaba).trim();
  }
  return String(process.env.WABA_ID_EDUCACION || fallbackWaba).trim();
}

module.exports = {
  refreshMetaSettingsCache,
  getVerifyToken,
  getAppSecret,
  getWhatsAppCredentialsForArea,
  getWabaIdOverrideForArea,
  KEYS,
  normalizeSecretValue,
  normalizeCredentialArea,
  VALID_META_AREAS,
};
