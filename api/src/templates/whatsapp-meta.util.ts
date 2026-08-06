import {
  normalizeArea,
  type BusinessArea,
} from '../config/areas';
import {
  getWabaIdOverrideForArea as getWabaFromStore,
  getWhatsAppCredentialsForArea as getCredsFromStore,
  type WhatsAppCredentials,
} from '../meta-settings/meta-settings.store';

export type { WhatsAppCredentials };

export function getWhatsAppCredentialsForArea(
  area: unknown,
): WhatsAppCredentials {
  return getCredsFromStore(area);
}

export function getWabaIdOverrideForArea(area: unknown): string {
  return getWabaFromStore(area);
}

const GRAPH_BASE = 'https://graph.facebook.com/v23.0';

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

type GraphErrorBody = {
  error?: {
    message?: string;
    error_user_title?: string;
    error_user_msg?: string;
    error_data?: { details?: string; messaging_product?: string };
  };
};

function formatGraphError(
  body: GraphErrorBody | null | undefined,
  fallback: string,
): string {
  const err = body?.error;
  if (!err) return fallback;
  const details = String(err.error_data?.details || '').trim();
  const userMsg = String(err.error_user_msg || '').trim();
  const userTitle = String(err.error_user_title || '').trim();
  const message = String(err.message || '').trim();
  // Prefer Meta's actionable detail over the generic "(#100) Invalid parameter".
  const primary = details || userMsg || message || fallback;
  const extras = [userTitle, userMsg, message]
    .map((part) => part.trim())
    .filter(
      (part) =>
        part &&
        part.toLowerCase() !== primary.toLowerCase() &&
        // Avoid repeating the same generic Invalid parameter next to real details.
        !(details && /^(\(#\d+\)\s*)?invalid parameter\.?$/i.test(part)),
    );
  if (!extras.length) return primary;
  const unique = [...new Set(extras)];
  return `${primary} (${unique.join(' · ')})`;
}

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
    const err = new Error(
      formatGraphError(
        body,
        `Meta Graph API error ${response.status} en ${path}`,
      ),
    );
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
    throw new Error(
      formatGraphError(
        parsed,
        `Meta Graph API error ${response.status} en ${path}`,
      ),
    );
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
      formatGraphError(
        initBody,
        'Error iniciando upload de cabecera en Meta.',
      ),
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
      formatGraphError(uploadBody, 'Error subiendo cabecera media.'),
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

