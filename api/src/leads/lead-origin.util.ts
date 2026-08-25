import type { LeadChannel } from './leads.types';

/** Canales que nunca captan con conversación WA al registrar el origen (formulario Meta, import, etc.). */
export const CONTACT_ONLY_LEAD_CHANNELS = new Set<LeadChannel>([
  'meta_lead_form',
  'tiktok',
  'import',
  'manual',
  'other',
]);

/**
 * true si el origen vino con conversación / inbound al captar (no solo contacto).
 * - CTWA / orgánico: conversation_id en el origen.
 * - Widget: conversación resuelta (el widget puede abrir WA con chat).
 * - Form / import / manual: siempre false (aunque luego exista chat).
 */
export function originCameWithInbound(
  channel: string,
  originConversationId: number | null | undefined,
  resolvedChatConversationId?: number | null | undefined,
): boolean {
  const ch = channel as LeadChannel;
  if (ch === 'meta_ctwa' || ch === 'organic_wa') {
    return originConversationId != null;
  }
  if (ch === 'widget') {
    return resolvedChatConversationId != null;
  }
  if (CONTACT_ONLY_LEAD_CHANNELS.has(ch)) return false;
  return originConversationId != null;
}

export type LeadChatEnrichInput = {
  channel?: string;
  conversation_id?: number | null;
  contact_id?: number | null;
  contacts?: { id: number; phone: string | null } | null;
};

export type LeadChatEnrichResult = {
  chat_conversation_id: number | null;
  came_with_inbound: boolean;
};

export function resolveLeadChatEnrichment(
  row: LeadChatEnrichInput,
  convMaps: {
    byId: Map<number, number>;
    byContact: Map<number, number>;
    byPhone: Map<string, number>;
  },
): LeadChatEnrichResult {
  const channel = row.channel ?? 'other';
  const contactId = row.contact_id ?? row.contacts?.id ?? null;
  const phone = row.contacts?.phone?.trim() || null;
  const chatConversationId =
    (row.conversation_id != null
      ? convMaps.byId.get(row.conversation_id)
      : undefined) ??
    (contactId != null ? convMaps.byContact.get(contactId) : undefined) ??
    (phone ? convMaps.byPhone.get(phone) : undefined) ??
    row.conversation_id ??
    null;

  return {
    chat_conversation_id: chatConversationId,
    came_with_inbound: originCameWithInbound(
      channel,
      row.conversation_id,
      chatConversationId,
    ),
  };
}
