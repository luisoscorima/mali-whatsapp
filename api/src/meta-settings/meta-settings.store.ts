import {
  BUSINESS_AREAS,
  normalizeArea,
  type BusinessArea,
} from '../config/areas';
import { META_SETTING_KEYS } from './meta-settings.keys';

export type WhatsAppCredentials = {
  token: string;
  phoneNumberId: string;
  area: BusinessArea;
};

const ENV_BY_AREA: Record<
  BusinessArea,
  { token: string; phone: string; waba: string }
> = {
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
  educacion_ca: {
    token: 'WHATSAPP_TOKEN_EDUCACION_CA',
    phone: 'PHONE_NUMBER_ID_EDUCACION_CA',
    waba: 'WABA_ID_EDUCACION_CA',
  },
  educacion_ep: {
    token: 'WHATSAPP_TOKEN_EDUCACION_EP',
    phone: 'PHONE_NUMBER_ID_EDUCACION_EP',
    waba: 'WABA_ID_EDUCACION_EP',
  },
};

type MetaCache = {
  global: Record<string, string>;
} & Record<BusinessArea, Record<string, string>>;

function emptyCache(): MetaCache {
  const base = { global: {} } as MetaCache;
  for (const area of BUSINESS_AREAS) {
    base[area] = {};
  }
  return base;
}

let cache: MetaCache = emptyCache();
const warnedPhoneIdDupWithTi = new Set<string>();

export function normalizeSecretValue(value: unknown): string {
  let v = String(value ?? '')
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

export function setMetaSettingsCache(rows: { area: string; key: string; value: string }[]): void {
  const next = emptyCache();
  for (const row of rows) {
    const area = String(row.area || '').trim();
    if (area === 'global' || (BUSINESS_AREAS as readonly string[]).includes(area)) {
      (next as Record<string, Record<string, string>>)[area][row.key] = row.value;
    }
  }
  cache = next;
  warnedPhoneIdDupWithTi.clear();
}

export function getVerifyToken(): string {
  return normalizeSecretValue(
    cache.global[META_SETTING_KEYS.verifyToken] || process.env.VERIFY_TOKEN || '',
  );
}

export function getAppSecret(): string {
  return normalizeSecretValue(
    cache.global[META_SETTING_KEYS.appSecret] || process.env.APP_SECRET || '',
  );
}

function buildWhatsAppCredentialsRaw(norm: BusinessArea): {
  token: string;
  phoneNumberId: string;
} {
  const row = cache[norm] || {};
  let token = normalizeSecretValue(row[META_SETTING_KEYS.whatsappToken] || '');
  let phoneNumberId = String(row[META_SETTING_KEYS.phoneNumberId] || '').trim();

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

export function getWhatsAppCredentialsForArea(area: unknown): WhatsAppCredentials {
  const norm = normalizeArea(area);
  let { token, phoneNumberId } = buildWhatsAppCredentialsRaw(norm);

  if (norm !== 'ti') {
    const tiPid = String(buildWhatsAppCredentialsRaw('ti').phoneNumberId || '').trim();
    const pid = String(phoneNumberId || '').trim();
    if (tiPid && pid && pid === tiPid) {
      const fallbackPhone = String(process.env.PHONE_NUMBER_ID || '').trim();
      const envKeys = ENV_BY_AREA[norm] || ENV_BY_AREA.ti;
      const preferred = String(process.env[envKeys.phone] || fallbackPhone).trim();
      if (preferred && preferred !== pid) {
        if (!warnedPhoneIdDupWithTi.has(norm)) {
          warnedPhoneIdDupWithTi.add(norm);
          console.warn(
            JSON.stringify({
              level: 'warn',
              message:
                'Credenciales Meta: Phone Number ID en app_settings coincide con TI; se usa PHONE_NUMBER_ID_* del entorno',
              area: norm,
            }),
          );
        }
        phoneNumberId = preferred;
      }
    }
  }

  return { token, phoneNumberId, area: norm };
}

export function getWabaIdOverrideForArea(area: unknown): string {
  const norm = normalizeArea(area);
  const row = cache[norm];
  const fromDb = String(row?.[META_SETTING_KEYS.wabaId] || '').trim();
  if (fromDb) return fromDb;
  const fallbackWaba = String(process.env.WABA_ID || '').trim();
  const envKeys = ENV_BY_AREA[norm] || ENV_BY_AREA.ti;
  return String(process.env[envKeys.waba] || fallbackWaba).trim();
}

/** Display phone (+51…) guardado en BD tras sync Graph; vacío si aún no se sincronizó. */
export function getStoredDisplayPhoneNumber(area: unknown): string {
  const norm = normalizeArea(area);
  return String(
    cache[norm]?.[META_SETTING_KEYS.displayPhoneNumber] || '',
  ).trim();
}

export function getStoredMetaRows(): MetaCache {
  return cache;
}
