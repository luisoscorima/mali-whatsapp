/** Meta's business-scoped user ID: country code, period, opaque identifier. */
export const WHATSAPP_BSUID_REGEX = /^[A-Z]{2}\.[A-Za-z0-9]{1,128}$/;

export function isWhatsAppBsuid(value: unknown): value is string {
  return typeof value === 'string' && WHATSAPP_BSUID_REGEX.test(value.trim());
}

export function normalizeWhatsAppRecipient(value: unknown): string {
  const raw = String(value ?? '').trim();
  return WHATSAPP_BSUID_REGEX.test(raw) ? raw : raw.replace(/\D/g, '');
}

/** Prefer the real phone; fall back to the opaque ID only for API addressing. */
export function conversationRecipient(identity: {
  phone: string | null;
  whatsapp_user_id: string | null;
}): string {
  const recipient = identity.phone || identity.whatsapp_user_id;
  if (!recipient) throw new Error('La conversación no tiene destinatario de WhatsApp');
  return recipient;
}

/** Cloud API addresses phone numbers with `to` and BSUIDs with `recipient`. */
export function whatsappRecipientField(
  value: string,
): { to: string } | { recipient: string } {
  const id = String(value ?? '').trim();
  if (isWhatsAppBsuid(id)) return { recipient: id };
  return { to: id };
}
