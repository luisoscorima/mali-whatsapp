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
const MAX_MEDIA_DOCUMENT_BYTES = 100 * 1024 * 1024;

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
  return graphPostJson<SessionMessageResult>(`${phoneNumberId}/messages`, token, {
    messaging_product: 'whatsapp',
    to: input.to,
    type: 'text',
    text: { body: safe, preview_url: false },
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
  form.append('type', waType);
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
  mediaId: string;
  caption?: string;
  documentFilename?: string;
  phoneNumberId?: string | null;
}): Promise<SessionMessageResult> {
  const { token, phoneNumberId } = resolveWhatsAppSendCredentials({
    area: input.area,
    phoneNumberId: input.phoneNumberId,
  });
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
    payload.image = { id: input.mediaId, ...(cap ? { caption: cap } : {}) };
  } else if (input.waType === 'video') {
    payload.video = { id: input.mediaId, ...(cap ? { caption: cap } : {}) };
  } else if (input.waType === 'audio') {
    payload.audio = { id: input.mediaId };
  } else if (input.waType === 'document') {
    const fn =
      input.documentFilename && String(input.documentFilename).trim()
        ? String(input.documentFilename).trim()
        : 'documento.pdf';
    payload.document = {
      id: input.mediaId,
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

export { MAX_MEDIA_DOCUMENT_BYTES };
