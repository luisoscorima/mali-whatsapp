const SENDER_KEY = '_mali_sender';

export function readMessageSenderLabel(
  rawPayload: unknown,
  isAi: boolean,
  messageType: string,
): string | null {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return isAi ? 'IA' : null;
  }
  const record = rawPayload as Record<string, unknown>;
  const stored = record[SENDER_KEY];
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const label = String((stored as Record<string, unknown>).label ?? '').trim();
    if (label) return label;
  }
  if (isAi) return 'IA';
  const mt = String(messageType || '').trim().toLowerCase();
  if (mt === 'campaign') return 'Campaña';
  if (String(record.source ?? '').trim() === 'campaign_send') return 'Campaña';
  return null;
}

export function setMessageSender(
  rawPayload: unknown,
  label: string,
): Record<string, unknown> {
  const base =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? { ...(rawPayload as Record<string, unknown>) }
      : {};
  const safe = String(label ?? '').trim();
  if (!safe) {
    delete base[SENDER_KEY];
    return base;
  }
  base[SENDER_KEY] = { label: safe.slice(0, 120) };
  return base;
}
