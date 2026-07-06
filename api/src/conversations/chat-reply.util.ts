export type StoredMessageReplyTo = {
  message_id: number;
  preview: string;
  outbound: boolean;
};

const REPLY_KEY = '_mali_reply_to';

export function extractInboundReplyWaMessageId(
  msg: Record<string, unknown>,
): string | null {
  if (String(msg?.type || '').trim() === 'reaction') return null;
  const context = msg.context as { id?: string } | undefined;
  const waId = String(context?.id ?? '').trim();
  return waId || null;
}

export function extractReplyWaMessageIdFromRawPayload(
  rawPayload: unknown,
): string | null {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return null;
  }
  const record = rawPayload as Record<string, unknown>;
  if (record[REPLY_KEY]) return null;
  return extractInboundReplyWaMessageId(record);
}

export function readMessageReplyTo(
  rawPayload: unknown,
): StoredMessageReplyTo | null {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return null;
  }
  const record = rawPayload as Record<string, unknown>;
  const stored = record[REPLY_KEY];
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return null;
  }
  const reply = stored as Record<string, unknown>;
  const messageId = Number(reply.message_id);
  const preview = String(reply.preview ?? '').trim();
  if (!Number.isInteger(messageId) || messageId <= 0 || !preview) return null;
  return {
    message_id: messageId,
    preview,
    outbound: reply.outbound === true,
  };
}

export function setMessageReplyTo(
  rawPayload: unknown,
  input: StoredMessageReplyTo | null,
): Record<string, unknown> {
  const base =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? { ...(rawPayload as Record<string, unknown>) }
      : {};
  if (!input) {
    delete base[REPLY_KEY];
    return base;
  }
  base[REPLY_KEY] = {
    message_id: input.message_id,
    preview: input.preview.slice(0, 200),
    outbound: input.outbound,
  };
  return base;
}

export function buildMessageReplyPreview(
  bodyText: string | null,
  messageType: string,
): string {
  const text = String(bodyText ?? '').trim();
  if (text) return text.length > 120 ? `${text.slice(0, 120)}…` : text;
  const mt = String(messageType || '').trim().toLowerCase();
  if (mt === 'image') return 'Imagen';
  if (mt === 'video') return 'Video';
  if (mt === 'audio' || mt === 'voice') return 'Audio';
  if (mt === 'document') return 'Documento';
  if (mt === 'campaign') return 'Campaña';
  if (mt === 'sticker') return 'Sticker';
  return 'Mensaje';
}
