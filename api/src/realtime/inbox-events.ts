import type { InboxListItem } from '../conversations/conversations.types';

/** Eventos del dispatcher (nombres como Chatwoot `Events::Types`). */
export const InboxEvents = {
  messageCreated: 'message.created',
  messageUpdated: 'message.updated',
  conversationCreated: 'conversation.created',
  conversationUpdated: 'conversation.updated',
} as const;

export type InboxEventName = (typeof InboxEvents)[keyof typeof InboxEvents];

export type InboxDomainEvent = {
  name: InboxEventName;
  conversationId: number;
  messageId?: number;
  unreadChanged?: boolean;
  archivedChanged?: boolean;
};

/** Lo que recibe el navegador por Socket.IO (`inbox` event). */
export type InboxPushPayload = {
  conversation_id: number;
  events: InboxEventName[];
  conversation: InboxListItem | null;
  created_message_ids: number[];
  updated_message_ids: number[];
  unread_changed: boolean;
  archived_changed: boolean;
};

/** Ráfaga demasiado grande (masivos): el cliente recarga la lista una vez. */
export type InboxInvalidatedPayload = { reason: 'bulk' };

export const INBOX_SOCKET_EVENT = 'inbox';
export const INBOX_INVALIDATED_SOCKET_EVENT = 'inbox.invalidated';
