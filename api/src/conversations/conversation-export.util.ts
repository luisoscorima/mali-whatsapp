import * as XLSX from 'xlsx';
import {
  exportFilenameDateStamp,
  formatExportDate,
} from '../campaigns/campaign-format.util';

const TYPE_LABEL: Record<string, string> = {
  text: 'Texto',
  image: 'Imagen',
  video: 'Video',
  audio: 'Audio',
  voice: 'Nota de voz',
  document: 'Documento',
  sticker: 'Sticker',
  location: 'Ubicación',
  contacts: 'Contacto',
  button: 'Botón',
  interactive: 'Interactivo',
  campaign: 'Campaña',
  unknown: 'Otro',
};

function parseRawPayload(raw: unknown): Record<string, unknown> | null {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractMediaFileName(
  rawPayload: unknown,
  _messageType?: string,
): string {
  const p = parseRawPayload(rawPayload);
  if (!p) return '';
  const doc = p.document as { filename?: string } | undefined;
  if (doc?.filename) return String(doc.filename).trim();
  const localPreview = p.local_preview as { url?: string } | undefined;
  if (localPreview?.url) {
    const tail = String(localPreview.url).split('/').pop() || '';
    if (tail && tail.includes('.')) return tail;
  }
  return '';
}

function labelMessageType(messageType: string): string {
  const t = String(messageType || 'text').trim();
  return TYPE_LABEL[t] || t;
}

export type ConversationExportMessage = {
  direction: string;
  body_text: string | null;
  message_type: string;
  created_at: Date | string;
  raw_payload: unknown;
};

export function buildConversationExportRows(
  messages: ConversationExportMessage[],
): {
  fecha: string;
  remitente: string;
  tipo: string;
  texto: string;
  nombreMultimedia: string;
}[] {
  return messages.map((m) => {
    const remitente = m.direction === 'inbound' ? 'Cliente' : 'Equipo';
    const mediaName = extractMediaFileName(m.raw_payload, m.message_type);
    return {
      fecha: formatExportDate(m.created_at) || '',
      remitente,
      tipo: labelMessageType(m.message_type),
      texto: String(m.body_text ?? '').trim(),
      nombreMultimedia: mediaName,
    };
  });
}

export function buildConversationXlsxBuffer(
  rows: ReturnType<typeof buildConversationExportRows>,
): Buffer {
  const aoa = [
    ['Fecha y hora', 'Remitente', 'Tipo', 'Texto', 'Nombre multimedia'],
    ...rows.map((r) => [
      r.fecha,
      r.remitente,
      r.tipo,
      r.texto,
      r.nombreMultimedia,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 22 },
    { wch: 10 },
    { wch: 14 },
    { wch: 60 },
    { wch: 36 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Conversación');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function safeFilenamePart(value: string): string {
  return String(value || '')
    .replace(/[^\w.\-+]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

export function conversationExportFilename(
  phone: string,
  conversationId: number,
): string {
  const stamp = exportFilenameDateStamp();
  return `conversacion-${safeFilenamePart(phone)}-${conversationId}-${stamp}.xlsx`;
}
