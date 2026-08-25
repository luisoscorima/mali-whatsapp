import type { LeadChannel } from './leads.types';

/** Canales donde la captación es solo contacto (formulario, import, etc.), sin inbound WA al registrar el origen. */
export const CONTACT_ONLY_LEAD_CHANNELS = new Set<LeadChannel>([
  'meta_lead_form',
  'widget',
  'tiktok',
  'import',
  'manual',
  'other',
]);

/**
 * true si este origen se vinculó a una conversación WA en el momento de captación
 * (p. ej. CTWA u orgánico con conversation_id en contact_origins).
 */
export function originCameWithInbound(
  channel: string,
  originConversationId: number | null | undefined,
): boolean {
  if (CONTACT_ONLY_LEAD_CHANNELS.has(channel as LeadChannel)) return false;
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
    came_with_inbound: originCameWithInbound(channel, row.conversation_id),
  };
}
