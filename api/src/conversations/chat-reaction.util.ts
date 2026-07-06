export type StoredMessageReaction = {
  emoji: string;
  direction: 'inbound' | 'outbound';
  updated_at: string;
};

const REACTION_KEY = '_mali_reaction';

export function extractInboundReaction(msg: Record<string, unknown>): {
  targetWaMessageId: string;
  emoji: string;
} | null {
  if (String(msg?.type || '').trim() !== 'reaction') return null;
  const reaction = msg.reaction as
    | { message_id?: string; emoji?: string }
    | undefined;
  const targetWaMessageId = String(reaction?.message_id ?? '').trim();
  if (!targetWaMessageId) return null;
  return {
    targetWaMessageId,
    emoji: String(reaction?.emoji ?? '').trim(),
  };
}

export function readMessageReaction(
  rawPayload: unknown,
): StoredMessageReaction | null {
  if (!rawPayload || typeof rawPayload !== 'object' || Array.isArray(rawPayload)) {
    return null;
  }
  const record = rawPayload as Record<string, unknown>;
  const stored = record[REACTION_KEY];
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return null;
  }
  const reaction = stored as Record<string, unknown>;
  const emoji = String(reaction.emoji ?? '').trim();
  const direction = reaction.direction === 'outbound' ? 'outbound' : 'inbound';
  const updatedAt = String(reaction.updated_at ?? '').trim();
  if (!emoji) return null;
  return {
    emoji,
    direction,
    updated_at: updatedAt || new Date().toISOString(),
  };
}

export function setMessageReaction(
  rawPayload: unknown,
  input: { emoji: string; direction: 'inbound' | 'outbound' },
): Record<string, unknown> {
  const base =
    rawPayload && typeof rawPayload === 'object' && !Array.isArray(rawPayload)
      ? { ...(rawPayload as Record<string, unknown>) }
      : {};
  const emoji = String(input.emoji ?? '').trim();
  if (!emoji) {
    delete base[REACTION_KEY];
    return base;
  }
  base[REACTION_KEY] = {
    emoji,
    direction: input.direction,
    updated_at: new Date().toISOString(),
  };
  return base;
}

export function isReactionMessageType(messageType: string): boolean {
  return String(messageType || '').trim().toLowerCase() === 'reaction';
}
