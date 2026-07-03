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

export type TemplateHeaderFormat = 'IMAGE' | 'VIDEO' | 'DOCUMENT';

const MAX_MEDIA_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_VIDEO_BYTES = 16 * 1024 * 1024;
const MAX_MEDIA_DOCUMENT_BYTES = 100 * 1024 * 1024;

const TEMPLATE_HEADER_MIME_LIMITS: Record<
  string,
  { format: TemplateHeaderFormat; maxBytes: number }
> = {
  'image/jpeg': { format: 'IMAGE', maxBytes: MAX_MEDIA_IMAGE_BYTES },
  'image/jpg': { format: 'IMAGE', maxBytes: MAX_MEDIA_IMAGE_BYTES },
  'image/png': { format: 'IMAGE', maxBytes: MAX_MEDIA_IMAGE_BYTES },
  'video/mp4': { format: 'VIDEO', maxBytes: MAX_MEDIA_VIDEO_BYTES },
  'application/pdf': { format: 'DOCUMENT', maxBytes: MAX_MEDIA_DOCUMENT_BYTES },
};

export function classifyTemplateHeaderUpload(
  mimeType: string,
  sizeBytes: number,
): { mimeType: string; format: TemplateHeaderFormat; maxBytes: number } {
  const mime = String(mimeType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  const rule = TEMPLATE_HEADER_MIME_LIMITS[mime];
  if (!rule) {
    throw new Error(
      'Usa un archivo JPG, PNG, MP4 o PDF para la cabecera de la plantilla.',
    );
  }
  if (typeof sizeBytes === 'number' && sizeBytes > rule.maxBytes) {
    throw new Error(
      `Archivo de cabecera demasiado grande (máx. ${Math.round(rule.maxBytes / (1024 * 1024))} MB).`,
    );
  }
  return { mimeType: mime, format: rule.format, maxBytes: rule.maxBytes };
}

async function graphPost<T>(
  path: string,
  token: string,
  body: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const response = await fetch(`${GRAPH_BASE}/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as T & GraphErrorBody;
  if (!response.ok) {
    const message =
      parsed?.error?.message ||
      `Meta Graph API error ${response.status} en ${path}`;
    throw new Error(message);
  }
  return parsed;
}

export async function uploadTemplateHeaderHandle(input: {
  area: unknown;
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<string> {
  const { token } = getWhatsAppCredentialsForArea(input.area);
  if (!token) {
    throw new Error(
      'Faltan credenciales WhatsApp para generar el header handle.',
    );
  }
  const metaAppId = normalizeSecretValue(process.env.META_APP_ID);
  if (!metaAppId) {
    throw new Error(
      'Falta META_APP_ID para crear plantillas con cabecera media.',
    );
  }
  if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
    throw new Error('Archivo de ejemplo vacío o inválido.');
  }

  const { mimeType: safeMime } = classifyTemplateHeaderUpload(
    input.mimeType,
    input.buffer.length,
  );
  const safeName =
    String(input.filename || 'cabecera-media')
      .trim()
      .split(/[/\\]/)
      .pop() || 'cabecera-media';

  const initUrl = new URL(`${GRAPH_BASE}/${metaAppId}/uploads`);
  initUrl.searchParams.set('file_name', safeName);
  initUrl.searchParams.set('file_length', String(input.buffer.length));
  initUrl.searchParams.set('file_type', safeMime);
  initUrl.searchParams.set('access_token', token);

  const initRes = await fetch(initUrl, { method: 'POST' });
  const initBody = (await initRes.json()) as { id?: string } & GraphErrorBody;
  if (!initRes.ok) {
    throw new Error(
      initBody?.error?.message ||
        'Error iniciando upload de cabecera en Meta.',
    );
  }
  const sessionId = String(initBody?.id || '').trim();
  if (!sessionId) {
    throw new Error('Meta no devolvió una sesión de upload.');
  }

  const uploadRes = await fetch(`${GRAPH_BASE}/${sessionId}`, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${token}`,
      file_offset: '0',
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array(input.buffer),
  });
  const uploadBody = (await uploadRes.json()) as { h?: string } & GraphErrorBody;
  if (!uploadRes.ok) {
    throw new Error(
      uploadBody?.error?.message || 'Error subiendo cabecera media.',
    );
  }
  const handle = String(uploadBody?.h || '').trim();
  if (!handle) {
    throw new Error('Meta no devolvió el header handle.');
  }
  return handle;
}

export type CreateMessageTemplateResult = {
  id?: string;
  status?: string;
};

export async function createMessageTemplateOnWaba(input: {
  area: unknown;
  name: string;
  language: string;
  category: string;
  components: Record<string, unknown>[];
}): Promise<CreateMessageTemplateResult> {
  const { token, phoneNumberId } = getWhatsAppCredentialsForArea(input.area);
  if (!token || !phoneNumberId) {
    throw new Error('Faltan credenciales WhatsApp para crear plantilla');
  }
  const wabaId = await resolveWabaId(input.area, token, phoneNumberId);
  return graphPost<CreateMessageTemplateResult>(
    `${wabaId}/message_templates`,
    token,
    {
      name: String(input.name || '').trim(),
      language: String(input.language || 'es').trim(),
      category: String(input.category || 'MARKETING')
        .trim()
        .toUpperCase(),
      components: Array.isArray(input.components) ? input.components : [],
    },
  );
}

export type SendTemplateResult = {
  messaging_product?: string;
  contacts?: { input?: string; wa_id?: string }[];
  messages?: { id?: string }[];
};

export async function sendTemplateWithComponents(input: {
  to: string;
  templateName: string;
  languageCode: string;
  components?: Record<string, unknown>[];
  area: unknown;
}): Promise<SendTemplateResult> {
  const { token, phoneNumberId } = getWhatsAppCredentialsForArea(input.area);
  if (!token || !phoneNumberId) {
    throw new Error(
      'Faltan credenciales WhatsApp para esta area: define WHATSAPP_TOKEN_* y PHONE_NUMBER_ID_*',
    );
  }

  const templatePayload: Record<string, unknown> = {
    name: input.templateName,
    language: { code: input.languageCode },
  };
  if (Array.isArray(input.components) && input.components.length > 0) {
    templatePayload.components = input.components;
  }

  try {
    return await graphPost<SendTemplateResult>(
      `${phoneNumberId}/messages`,
      token,
      {
        messaging_product: 'whatsapp',
        to: input.to,
        type: 'template',
        template: templatePayload,
      },
    );
  } catch (error) {
    const err = error as Error & { status?: number };
    const wrapped = new Error(err.message || 'Error enviando plantilla') as Error & {
      response?: { data: unknown };
    };
    wrapped.response = {
      data: {
        error: { message: err.message },
        httpStatus: err.status,
      },
    };
    throw wrapped;
  }
}

