import path from 'node:path';
import {
  getWhatsAppCredentialsForArea,
  type WhatsAppCredentials,
} from '../templates/whatsapp-meta.util';
import { MAX_SESSION_TEXT_LEN } from '../settings/business-hours.util';

const GRAPH_BASE = 'https://graph.facebook.com/v23.0';

export const MAX_MEDIA_CAPTION_LEN = 1024;
const MAX_MEDIA_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_MEDIA_VIDEO_BYTES = 16 * 1024 * 1024;
const MAX_MEDIA_AUDIO_BYTES = 16 * 1024 * 1024;
const MAX_MEDIA_DOCUMENT_BYTES = 25 * 1024 * 1024;

const ALLOWED_MEDIA_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'video/mp4',
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'application/ogg',
  'audio/aac',
  'audio/mp4',
  'audio/x-m4a',
  'audio/m4a',
  'application/pdf',
]);

export type ConversationWaType = 'image' | 'video' | 'audio' | 'document';

export const MEDIA_TYPE_LABEL: Record<ConversationWaType, string> = {
  image: 'Imagen',
  video: 'Video',
  audio: 'Audio',
  document: 'Documento',
};

export function resolveWhatsAppSendCredentials(input: {
  area: unknown;
  phoneNumberId?: string | null;
}): WhatsAppCredentials {
  const creds = getWhatsAppCredentialsForArea(input.area);
  const override = String(input.phoneNumberId ?? '').trim();
  if (override) {
    if (!creds.token) {
      throw new Error(
        'Faltan credenciales WhatsApp para esta area: define WHATSAPP_TOKEN_*',
      );
    }
    return { ...creds, phoneNumberId: override };
  }
  if (!creds.token || !creds.phoneNumberId) {
    throw new Error(
      'Faltan credenciales WhatsApp para esta area: define WHATSAPP_TOKEN_* y PHONE_NUMBER_ID_*',
    );
  }
  return creds;
}

export function classifyConversationUpload(
  mimeType: string,
  sizeBytes: number,
): { waType: ConversationWaType; maxBytes: number } {
  const mime = String(mimeType || '')
    .toLowerCase()
    .split(';')[0]
    .trim();
  if (!mime || !ALLOWED_MEDIA_MIMES.has(mime)) {
    throw new Error(
      'Tipo de archivo no permitido. Usa JPEG/PNG, MP4, audio (MP3/OGG/AAC/M4A) o PDF.',
    );
  }
  let waType: ConversationWaType;
  let maxBytes: number;
  if (mime === 'image/jpeg' || mime === 'image/jpg' || mime === 'image/png') {
    waType = 'image';
    maxBytes = MAX_MEDIA_IMAGE_BYTES;
  } else if (mime === 'video/mp4') {
    waType = 'video';
    maxBytes = MAX_MEDIA_VIDEO_BYTES;
  } else if (mime === 'application/pdf') {
    waType = 'document';
    maxBytes = MAX_MEDIA_DOCUMENT_BYTES;
  } else {
    waType = 'audio';
    maxBytes = MAX_MEDIA_AUDIO_BYTES;
  }
  if (typeof sizeBytes === 'number' && sizeBytes > maxBytes) {
    throw new Error(
      `Archivo demasiado grande (máx. ${Math.round(maxBytes / (1024 * 1024))} MB para este tipo).`,
    );
  }
  return { waType, maxBytes };
}

function sanitizeUploadFilename(
  originalName: string,
  waType: ConversationWaType,
): string {
  let base = path.basename(String(originalName || ''));
  base = base.replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]/g, '_').trim();
  if (!base) {
    base =
      waType === 'document'
        ? 'documento.pdf'
        : waType === 'image'
          ? 'imagen.jpg'
          : waType === 'video'
            ? 'video.mp4'
            : 'audio.m4a';
  }
  return base.slice(0, 200);
}

export type SessionMessageResult = {
  messaging_product?: string;
  contacts?: unknown[];
  messages?: { id?: string }[];
};

async function graphPostJson<T>(
  pathSegment: string,
  token: string,
  body: unknown,
): Promise<T> {
  const response = await fetch(`${GRAPH_BASE}/${pathSegment}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as T & {
    error?: { message?: string };
  };
  if (!response.ok) {
    const message =
      parsed?.error?.message ||
      `Meta Graph API error ${response.status} en ${pathSegment}`;
    throw new Error(message);
  }
  return parsed;
}

export async function sendSessionTextMessage(input: {
  to: string;
  text: string;
  area: unknown;
  phoneNumberId?: string | null;
  replyToWaMessageId?: string | null;
}): Promise<SessionMessageResult> {
  const { token, phoneNumberId } = resolveWhatsAppSendCredentials({
    area: input.area,
    phoneNumberId: input.phoneNumberId,
  });
  const safe = String(input.text || '').trim();
  if (!safe) throw new Error('Mensaje vacio');
  if (safe.length > MAX_SESSION_TEXT_LEN) {
    throw new Error(`Mensaje demasiado largo (max ${MAX_SESSION_TEXT_LEN})`);
  }
  const replyTo = String(input.replyToWaMessageId ?? '').trim();
  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'text',
    text: { body: safe, preview_url: false },
  };
  if (replyTo) {
    payload.context = { message_id: replyTo };
  }
  return graphPostJson<SessionMessageResult>(`${phoneNumberId}/messages`, token, payload);
}

/** Reply buttons de sesión (máx. 3). `id` = payload estable para el motor de flujos. */
export const MAX_INTERACTIVE_BUTTONS = 3;
export const INTERACTIVE_BUTTON_TITLE_MAX = 20;
export const INTERACTIVE_BUTTON_ID_MAX = 256;

export async function sendSessionInteractiveButtons(input: {
  to: string;
  bodyText: string;
  buttons: { id: string; title: string }[];
  area: unknown;
  phoneNumberId?: string | null;
  footerText?: string | null;
}): Promise<SessionMessageResult> {
  const { token, phoneNumberId } = resolveWhatsAppSendCredentials({
    area: input.area,
    phoneNumberId: input.phoneNumberId,
  });
  const body = String(input.bodyText || '').trim();
  if (!body) throw new Error('Mensaje vacio');
  if (body.length > MAX_SESSION_TEXT_LEN) {
    throw new Error(`Mensaje demasiado largo (max ${MAX_SESSION_TEXT_LEN})`);
  }
  const buttons = Array.isArray(input.buttons) ? input.buttons : [];
  if (buttons.length < 1 || buttons.length > MAX_INTERACTIVE_BUTTONS) {
    throw new Error(
      `Se requieren entre 1 y ${MAX_INTERACTIVE_BUTTONS} botones interactivos.`,
    );
  }
  const actionButtons = buttons.map((btn, idx) => {
    const id = String(btn?.id || '').trim();
    const title = String(btn?.title || '').trim();
    if (!id) throw new Error(`Payload del botón ${idx + 1} es obligatorio.`);
    if (id.length > INTERACTIVE_BUTTON_ID_MAX) {
      throw new Error(
        `Payload del botón ${idx + 1} no puede superar ${INTERACTIVE_BUTTON_ID_MAX} caracteres.`,
      );
    }
    if (!title) throw new Error(`Texto del botón ${idx + 1} es obligatorio.`);
    if (title.length > INTERACTIVE_BUTTON_TITLE_MAX) {
      throw new Error(
        `Texto del botón ${idx + 1} no puede superar ${INTERACTIVE_BUTTON_TITLE_MAX} caracteres.`,
      );
    }
    return { type: 'reply', reply: { id, title } };
  });
  const interactive: Record<string, unknown> = {
    type: 'button',
    body: { text: body },
    action: { buttons: actionButtons },
  };
  const footer = String(input.footerText || '').trim();
  if (footer) {
    interactive.footer = { text: footer.slice(0, 60) };
  }
  return graphPostJson<SessionMessageResult>(`${phoneNumberId}/messages`, token, {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'interactive',
    interactive,
  });
}

export async function sendMessageReaction(input: {
  to: string;
  waMessageId: string;
  emoji: string;
  area: unknown;
  phoneNumberId?: string | null;
}): Promise<SessionMessageResult> {
  const { token, phoneNumberId } = resolveWhatsAppSendCredentials({
    area: input.area,
    phoneNumberId: input.phoneNumberId,
  });
  const waMessageId = String(input.waMessageId || '').trim();
  if (!waMessageId) throw new Error('Mensaje de WhatsApp no disponible');
  const emoji = String(input.emoji || '').trim();
  return graphPostJson<SessionMessageResult>(`${phoneNumberId}/messages`, token, {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'reaction',
    reaction: {
      message_id: waMessageId,
      emoji,
    },
  });
}

export async function uploadMediaToWhatsApp(input: {
  area: unknown;
  buffer: Buffer;
  mimeType: string;
  filename: string;
  phoneNumberId?: string | null;
}): Promise<{
  mediaId: string;
  waType: ConversationWaType;
  safeFilename: string;
}> {
  const { token, phoneNumberId } = resolveWhatsAppSendCredentials({
    area: input.area,
    phoneNumberId: input.phoneNumberId,
  });
  if (!Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
    throw new Error('Archivo vacío o inválido');
  }
  const { waType } = classifyConversationUpload(
    input.mimeType,
    input.buffer.length,
  );
  const safeName = sanitizeUploadFilename(input.filename, waType);
  const mime = String(input.mimeType).split(';')[0].trim();

  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', mime);
  form.append('file', new Blob([new Uint8Array(input.buffer)], { type: mime }), safeName);

  const response = await fetch(`${GRAPH_BASE}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = (await response.json()) as { id?: string } & {
    error?: { message?: string };
  };
  if (!response.ok) {
    throw new Error(data?.error?.message || 'Error subiendo media');
  }
  if (!data?.id) {
    throw new Error('Respuesta de subida sin id de media');
  }
  return { mediaId: String(data.id), waType, safeFilename: safeName };
}

export async function sendSessionMediaMessage(input: {
  to: string;
  area: unknown;
  waType: ConversationWaType;
  mediaId?: string;
  mediaLink?: string;
  caption?: string;
  documentFilename?: string;
  phoneNumberId?: string | null;
}): Promise<SessionMessageResult> {
  const { token, phoneNumberId } = resolveWhatsAppSendCredentials({
    area: input.area,
    phoneNumberId: input.phoneNumberId,
  });
  const mediaId = String(input.mediaId || '').trim();
  const mediaLink = String(input.mediaLink || '').trim();
  if (!mediaId && !mediaLink) {
    throw new Error('media id o link requerido');
  }
  const mediaRef = mediaId ? { id: mediaId } : { link: mediaLink };
  const cap =
    input.caption != null && String(input.caption).trim()
      ? String(input.caption).trim().slice(0, MAX_MEDIA_CAPTION_LEN)
      : '';

  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: input.to,
    type: input.waType,
  };

  if (input.waType === 'image') {
    payload.image = { ...mediaRef, ...(cap ? { caption: cap } : {}) };
  } else if (input.waType === 'video') {
    payload.video = { ...mediaRef, ...(cap ? { caption: cap } : {}) };
  } else if (input.waType === 'audio') {
    if (!mediaId) throw new Error('Audio requiere media id');
    payload.audio = { id: mediaId };
  } else if (input.waType === 'document') {
    const fn =
      input.documentFilename && String(input.documentFilename).trim()
        ? String(input.documentFilename).trim()
        : 'documento.pdf';
    payload.document = {
      ...mediaRef,
      filename: fn.slice(0, 240),
      ...(cap ? { caption: cap } : {}),
    };
  } else {
    throw new Error('Tipo de media no soportado');
  }

  return graphPostJson<SessionMessageResult>(
    `${phoneNumberId}/messages`,
    token,
    payload,
  );
}

export async function downloadWhatsAppMediaBuffer(input: {
  mediaId: string;
  area: unknown;
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const { token } = resolveWhatsAppSendCredentials({ area: input.area });
  const id = String(input.mediaId || '').trim();
  if (!id) throw new Error('media id vacío');

  const metaUrl = `${GRAPH_BASE}/${id}?fields=id,mime_type,sha256,file_size,url,messaging_product`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const meta = (await metaRes.json()) as {
    url?: string;
    mime_type?: string;
    file_size?: number;
    error?: { message?: string };
  };
  if (!metaRes.ok) {
    throw new Error(meta?.error?.message || `Meta media meta error ${metaRes.status}`);
  }

  const downloadUrl = meta?.url;
  const mimeFromMeta = meta?.mime_type
    ? String(meta.mime_type).split(';')[0].trim()
    : 'application/octet-stream';
  if (!downloadUrl) {
    throw new Error('Meta no devolvió URL de descarga para el media');
  }

  const maxInboundBytes = 100 * 1024 * 1024;
  if (meta.file_size != null && Number(meta.file_size) > maxInboundBytes) {
    throw new Error(
      'Archivo entrante demasiado grande para descargar en el panel',
    );
  }

  const fileRes = await fetch(downloadUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!fileRes.ok) {
    throw new Error(`Error descargando media (${fileRes.status})`);
  }
  const arrayBuffer = await fileRes.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    mimeType: mimeFromMeta,
  };
}

export { MAX_MEDIA_DOCUMENT_BYTES };
