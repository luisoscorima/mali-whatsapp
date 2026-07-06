export type MessageDeliveryStatus =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed';

export type MessageDeliveryInfo = {
  status: MessageDeliveryStatus;
  label: string;
};

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
  return mapDeliveryInfo(resolveStatusToken(rawPayload as Record<string, unknown>));
}
