export type MessageDeliveryStatus =
  | 'scheduled'
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export type MessageDeliveryInfo = {
  status: MessageDeliveryStatus;
  label: string;
  /** false = no mostrar Reintentar (p. ej. resultado incierto tras Meta). */
  retryable?: boolean;
};

export function readScheduledAt(rawPayload: unknown): string | null {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return null;
  }
  const raw = String(
    (rawPayload as Record<string, unknown>).scheduled_at ?? '',
  ).trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function isScheduledOutbound(rawPayload: unknown): boolean {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return false;
  }
  const token = resolveStatusToken(rawPayload as Record<string, unknown>);
  return token === 'scheduled';
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function resolveStatusToken(rawPayload: Record<string, unknown>): string {
  const delivery = parseJsonObject(rawPayload.delivery_status);
  const fromWebhook = String(delivery?.status ?? '').trim().toLowerCase();
  if (fromWebhook) return fromWebhook;

  const direct = String(rawPayload.status ?? '').trim().toLowerCase();
  if (direct) return direct;

  const messages = rawPayload.messages;
  if (Array.isArray(messages) && messages[0] && typeof messages[0] === 'object') {
    const first = messages[0] as Record<string, unknown>;
    return String(first.message_status ?? '').trim().toLowerCase();
  }
  return '';
}

function mapDeliveryInfo(statusToken: string): MessageDeliveryInfo {
  if (statusToken === 'scheduled') {
    return { status: 'scheduled', label: 'Programado' };
  }
  if (statusToken === 'read') {
    return { status: 'read', label: 'Leído' };
  }
  if (statusToken === 'delivered') {
    return { status: 'delivered', label: 'Entregado' };
  }
  if (statusToken === 'failed' || statusToken === 'undelivered') {
    return { status: 'failed', label: 'Error de entrega' };
  }
  if (statusToken === 'sent' || statusToken === 'accepted') {
    return { status: 'sent', label: 'Enviado' };
  }
  return { status: 'pending', label: 'Enviando…' };
}

export function readMessageDelivery(rawPayload: unknown): MessageDeliveryInfo {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return { status: 'pending', label: 'Enviando…' };
  }
  const obj = rawPayload as Record<string, unknown>;
  if (obj.outbound_uncertain === true) {
    return {
      status: 'failed',
      label: 'Estado desconocido',
      retryable: false,
    };
  }
  const info = mapDeliveryInfo(resolveStatusToken(obj));
  const providerResult = parseJsonObject(obj.delivery_status);
  if (info.status === 'failed') {
    const detail = deliveryFailureDetail(providerResult);
    const withDetail = detail ? { ...info, label: `Error de entrega: ${detail}` } : info;
    if (obj.outbound_accepted_wamid || providerResult?.id) {
      return { ...withDetail, retryable: false };
    }
    return withDetail;
  }
  return info;
}

function deliveryFailureDetail(delivery: Record<string, unknown> | null): string {
  const errors = delivery?.errors;
  const first = Array.isArray(errors) ? errors[0] : null;
  if (!first || typeof first !== 'object') return '';
  const row = first as Record<string, unknown>;
  const data =
    row.error_data && typeof row.error_data === 'object'
      ? (row.error_data as Record<string, unknown>)
      : null;
  return String(data?.details || row.title || row.message || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

/** Orden de entrega: scheduled < pending < sent < delivered < read. failed no escala. */
export function deliveryStatusRank(status: string): number {
  switch (String(status || '').trim().toLowerCase()) {
    case 'read':
      return 4;
    case 'delivered':
      return 3;
    case 'sent':
    case 'accepted':
      return 2;
    case 'pending':
      return 1;
    case 'scheduled':
      return 0.5;
    default:
      return 0;
  }
}

export function readDeliveryStatusToken(rawPayload: unknown): string {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return '';
  }
  return resolveStatusToken(rawPayload as Record<string, unknown>);
}
