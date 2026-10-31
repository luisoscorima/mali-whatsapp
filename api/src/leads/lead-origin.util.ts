import type { LeadChannel } from './leads.types';

/** Canales que nunca cuentan como conversación aunque exista chat (import, etc.). */
export const CONTACT_ONLY_LEAD_CHANNELS = new Set<LeadChannel>([
  'import',
  'other',
]);

/** Form / widget: el lead “vino con chat” solo si ella abrió el hilo. */
export const FORM_LIKE_LEAD_CHANNELS = new Set<LeadChannel>([
  'widget',
  'meta_lead_form',
  'tiktok',
]);

/** Holgura si el form y el primer WA llegan casi juntos. */
export const FORM_CHAT_GRACE_MS = 5 * 60 * 1000;

export type ConversationHint = {
  id: number;
  has_inbound: boolean;
  /** Primer mensaje de la conversación es inbound (ella abrió el chat). */
  user_initiated: boolean;
  first_message_at: Date | null;
};

/**
 * true si el origen cuenta como contacto + chat (no solo contacto).
 * - CTWA / orgánico / links: conversation_id en el origen.
 * - Widget / Instant Form / TikTok: ella inició un hilo en/después de la captura
 *   (no basta responder a una campaña outbound nuestra).
 * - import / other: siempre false.
 */
export function originCameWithInbound(
  channel: string,
  originConversationId: number | null | undefined,
  resolvedHasInbound?: boolean,
  opts?: {
    userInitiated?: boolean;
    firstMessageAt?: Date | null;
    originFirstSeenAt?: Date | null;
  },
): boolean {
  const ch = channel as LeadChannel;
  if (
    ch === 'meta_ctwa' ||
    ch === 'organic_wa' ||
    ch === 'mali_one_link' ||
    ch === 'web_button'
  ) {
    return originConversationId != null;
  }
  if (FORM_LIKE_LEAD_CHANNELS.has(ch)) {
    if (!opts?.userInitiated || !opts.firstMessageAt) return false;
    const originAt = opts.originFirstSeenAt;
    if (!originAt) return true;
    return (
      opts.firstMessageAt.getTime() >=
      originAt.getTime() - FORM_CHAT_GRACE_MS
    );
  }
  if (CONTACT_ONLY_LEAD_CHANNELS.has(ch)) return false;
  return originConversationId != null || Boolean(resolvedHasInbound);
}

export type LeadChatEnrichInput = {
  channel?: string;
  conversation_id?: number | null;
  contact_id?: number | null;
  contacts?: { id: number; phone: string | null } | null;
  /** Captura del origen (form / widget). */
  first_seen_at?: Date | string | null;
  created_time?: Date | string | null;
};

export type LeadChatEnrichResult = {
  chat_conversation_id: number | null;
  came_with_inbound: boolean;
};

export type LeadConversationMaps = {
  byId: Map<number, ConversationHint>;
  byContact: Map<number, ConversationHint[]>;
  byPhone: Map<string, ConversationHint[]>;
};

function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function hintsForRow(
  row: LeadChatEnrichInput,
  maps: LeadConversationMaps,
): ConversationHint[] {
  const contactId = row.contact_id ?? row.contacts?.id ?? null;
  const phone = row.contacts?.phone?.trim() || null;
  if (row.conversation_id != null) {
    const one = maps.byId.get(row.conversation_id);
    if (one) return [one];
  }
  if (contactId != null) {
    const list = maps.byContact.get(contactId);
    if (list?.length) return list;
  }
  if (phone) {
    const list = maps.byPhone.get(phone);
    if (list?.length) return list;
  }
  return [];
}

/** ¿Ella abrió algún hilo en/después de la captura del form? */
export function formLikeCameWithInbound(
  hints: ConversationHint[],
  originFirstSeenAt: Date | null,
): boolean {
  return hints.some((h) =>
    originCameWithInbound('tiktok', null, h.has_inbound, {
      userInitiated: h.user_initiated,
      firstMessageAt: h.first_message_at,
      originFirstSeenAt,
    }),
  );
}

export function resolveLeadChatEnrichment(
  row: LeadChatEnrichInput,
  convMaps: LeadConversationMaps,
): LeadChatEnrichResult {
  const channel = row.channel ?? 'other';
  const hints = hintsForRow(row, convMaps);
  const originFirstSeenAt =
    asDate(row.first_seen_at) ?? asDate(row.created_time);

  const initiated = hints.find((h) =>
    FORM_LIKE_LEAD_CHANNELS.has(channel as LeadChannel)
      ? formLikeCameWithInbound([h], originFirstSeenAt)
      : h.user_initiated,
  );
  const withInbound = hints.find((h) => h.has_inbound);
  const any = hints[0];
  const preferred = initiated ?? withInbound ?? any;

  const chatConversationId =
    preferred?.id ?? row.conversation_id ?? null;

  if (FORM_LIKE_LEAD_CHANNELS.has(channel as LeadChannel)) {
    return {
      chat_conversation_id: chatConversationId,
      came_with_inbound: formLikeCameWithInbound(hints, originFirstSeenAt),
    };
  }

  return {
    chat_conversation_id: chatConversationId,
    came_with_inbound: originCameWithInbound(
      channel,
      row.conversation_id,
      preferred?.has_inbound,
    ),
  };
}
