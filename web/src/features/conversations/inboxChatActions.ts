export type ChatActionsContext = {
  conversationId: number | null
  heading: string
  phone: string
  contactId: number | null
  leadScore: number | null
  aiAreaEnabled: boolean
  conversationStatus: string | null
  assignedUserId: number | null
  archived: boolean
  lastUserMessageAt: string | null
}

type ListItemLike = {
  id: number
  phone: string
  contact_name: string
  contact_id: number | null
  contact_lead_score: number | null
  conversation_status: string | null
  assigned_user_id: number | null
  is_virtual: boolean
  archived?: boolean
  last_user_message_at?: string | null
}

type DetailLike = {
  conversation: {
    id: number
    phone: string
    status: string
    contact_id: number | null
    assigned_user_id: number | null
    archived?: boolean
    last_user_message_at?: string | null
  }
  contact: {
    lead_score: number | null
  } | null
}

export function chatActionsFromListItem(
  item: ListItemLike,
  aiAreaEnabled: boolean,
  heading: string,
): ChatActionsContext {
  return {
    conversationId: item.is_virtual ? null : item.id,
    heading,
    phone: item.phone,
    contactId: item.contact_id,
    leadScore: item.contact_lead_score,
    aiAreaEnabled,
    conversationStatus: item.conversation_status,
    assignedUserId: item.is_virtual ? null : item.assigned_user_id,
    archived: Boolean(item.archived),
    lastUserMessageAt: item.last_user_message_at ?? null,
  }
}

export function chatActionsFromDetail(
  detail: DetailLike,
  heading: string,
  aiAreaEnabled: boolean,
): ChatActionsContext {
  return {
    conversationId: detail.conversation.id,
    heading,
    phone: detail.conversation.phone,
    contactId: detail.conversation.contact_id,
    leadScore: detail.contact?.lead_score ?? null,
    aiAreaEnabled,
    conversationStatus: detail.conversation.status,
    assignedUserId: detail.conversation.assigned_user_id,
    archived: Boolean(detail.conversation.archived),
    lastUserMessageAt: detail.conversation.last_user_message_at ?? null,
  }
}
