import {
  BUSINESS_AREAS,
  normalizeArea,
  type BusinessArea,
} from '../config/areas';

const GRAPH_BASE = 'https://graph.facebook.com/v23.0';

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

function normalizeSecretValue(value: unknown): string {
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

export type WhatsAppCredentials = {
  token: string;
  phoneNumberId: string;
  area: BusinessArea;
};

export function getWhatsAppCredentialsForArea(
  area: unknown,
): WhatsAppCredentials {
  const norm = normalizeArea(area);
  const keys = ENV_BY_AREA[norm];
  const fallbackToken = normalizeSecretValue(process.env.WHATSAPP_TOKEN);
  const fallbackPhone = normalizeSecretValue(process.env.PHONE_NUMBER_ID);
  const token =
    normalizeSecretValue(process.env[keys.token]) || fallbackToken;
  const phoneNumberId =
    normalizeSecretValue(process.env[keys.phone]) || fallbackPhone;
  return { token, phoneNumberId, area: norm };
}

export function getWabaIdOverrideForArea(area: unknown): string {
  const norm = normalizeArea(area);
  const keys = ENV_BY_AREA[norm];
  const fromEnv =
    normalizeSecretValue(process.env[keys.waba]) ||
    normalizeSecretValue(process.env.WABA_ID);
  return fromEnv;
}

type GraphErrorBody = {
  error?: { message?: string };
};

async function graphGet<T>(
  path: string,
  token: string,
  params?: Record<string, string>,
): Promise<T> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value) url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as T & GraphErrorBody;
  if (!response.ok) {
    const message =
      body?.error?.message ||
      `Meta Graph API error ${response.status} en ${path}`;
    const err = new Error(message);
    (err as Error & { status?: number }).status = response.status;
    throw err;
  }
  return body;
}

async function fetchWabaIdFromPhoneNumberId(
  phoneNumberId: string,
  token: string,
): Promise<string> {
  const idStr = String(phoneNumberId || '').trim();

  try {
    const data = await graphGet<{
      whatsapp_business_account?: { id?: string };
    }>(idStr, token, { fields: 'whatsapp_business_account{id}' });
    const id = data?.whatsapp_business_account?.id;
    if (id) return String(id);
  } catch (e) {
    const status = (e as Error & { status?: number }).status;
    if (status !== 400) throw e;
  }

  try {
    const data = await graphGet<{ id?: string }>(
      `${idStr}/whatsapp_business_account`,
      token,
      { fields: 'id,name' },
    );
    if (data?.id) return String(data.id);
  } catch {
    // continuar
  }

  try {
    await graphGet(`${idStr}/message_templates`, token, { limit: '1' });
    return idStr;
  } catch {
    // continuar
  }

  throw new Error(
    'No se pudo obtener el WhatsApp Business Account (WABA). ' +
      'Define WABA_ID_* en .env o verifica PHONE_NUMBER_ID_*.',
  );
}

export async function resolveWabaId(
  area: unknown,
  token: string,
  phoneNumberId: string,
): Promise<string> {
  const override = getWabaIdOverrideForArea(area);
  if (override) return override;
  if (!phoneNumberId) {
    throw new Error('Falta PHONE_NUMBER_ID_* para resolver WABA');
  }
  return fetchWabaIdFromPhoneNumberId(phoneNumberId, token);
}

export type MetaMessageTemplate = {
  id?: string;
  name?: string;
  status?: string;
  language?: string;
  category?: string;
  components?: unknown[];
};

type TemplatesPage = {
  data?: MetaMessageTemplate[];
  paging?: { cursors?: { after?: string } };
};

export async function fetchAllMessageTemplates(
  wabaId: string,
  token: string,
): Promise<MetaMessageTemplate[]> {
  const all: MetaMessageTemplate[] = [];
  let after: string | null = null;
  do {
    const params: Record<string, string> = {
      fields: 'name,status,language,category,components,id',
      limit: '100',
    };
    if (after) params.after = after;
    const data = await graphGet<TemplatesPage>(
      `${wabaId}/message_templates`,
      token,
      params,
    );
    const list = Array.isArray(data.data) ? data.data : [];
    all.push(...list);
    after = data.paging?.cursors?.after || null;
  } while (after);
  return all;
}

export { BUSINESS_AREAS };
