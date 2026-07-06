import { formatAdvisorLabel } from '../users/advisor-label.util';

const SENDER_KEY = '_mali_sender';

function actorLabelFromEmail(email: string | null | undefined): string | null {
  const raw = String(email ?? '').trim();
  if (!raw) return null;
  return formatAdvisorLabel({ email: raw, first_name: null, last_name: null });
}

function readAuditMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return meta as Record<string, unknown>;
}

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

type AuditReplyRow = {
  actor_email: string | null;
  created_at: Date;
  meta: unknown;
};

export function matchAuditSenderLabel(
  message: {
    body_text: string | null;
    created_at: string;
    message_type: string;
  },
  audits: AuditReplyRow[],
): string | null {
  const at = new Date(message.created_at).getTime();
  if (Number.isNaN(at)) return null;
  const body = String(message.body_text ?? '').trim();
  const mt = String(message.message_type || '').trim().toLowerCase();

  let best: { label: string; delta: number } | null = null;
  for (const audit of audits) {
    const auditAt = audit.created_at.getTime();
    const delta = Math.abs(auditAt - at);
    if (delta > 3 * 60 * 1000) continue;

    const meta = readAuditMeta(audit.meta);
    const preview = String(meta.text_preview ?? '').trim();
    const mediaType = String(meta.media_type ?? '').trim().toLowerCase();

    let matches = false;
    if (preview && body) {
      matches =
        body === preview ||
        body.startsWith(preview) ||
        preview.startsWith(body.slice(0, 120));
    } else if (mediaType && mediaType === mt) {
      matches = true;
    } else if (!preview && !body && delta < 60_000) {
      matches = true;
    }
    if (!matches) continue;

    const label = actorLabelFromEmail(audit.actor_email);
    if (!label) continue;
    if (!best || delta < best.delta) best = { label, delta };
  }
  return best?.label ?? null;
}
