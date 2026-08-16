export type InboxChatFilter =
  | 'all'
  | 'unread'
  | 'bot'
  | 'human'
  | 'mine'
  | 'unassigned'
  | 'unanswered'
  | 'archived'
  | 'archived_auto'
  | 'archived_manual';

/** Horas máximas restantes de ventana 24h (buckets). null = sin filtro. */
export type InboxWindowMaxFilter = 2 | 6 | 12 | 24 | null;

export type InboxSegmentOption = {
  slug: string;
  label: string;
  color_key: string;
  assignment_group?: string | null;
};

export type InboxListItem = {
  id: number;
  phone: string;
  last_message_at: string | null;
  inbox_unread: boolean;
  conversation_status: string | null;
  assigned_user_id: number | null;
  assigned_user_label: string | null;
  automation_touched_at: string | null;
  contact_name: string;
  wa_profile_name: string | null;
  contact_lead_score: number | null;
  contact_segment_slugs: string[];
  preview: string;
  conversation_tags: string[];
  is_virtual: boolean;
  contact_id: number | null;
  matched_message_id: number | null;
  user_service_window_open: boolean;
  last_user_message_at: string | null;
  last_outbound_message_at: string | null;
  archived: boolean;
};

export type InboxListResult = {
  items: InboxListItem[];
  total_count: number;
  page: number;
  pages: number;
  unread_count: number;
  archived_count: number;
  ai_area_enabled: boolean;
  can_assign_conversations: boolean;
  segments: InboxSegmentOption[];
  assignable_segments: InboxSegmentOption[];
  filters: {
    q: string;
    chat: InboxChatFilter;
    window_max: InboxWindowMaxFilter;
    segment_slugs: string[];
    include_none: boolean;
  };
};

export type InboxMessageReaction = {
  emoji: string;
  direction: 'inbound' | 'outbound';
};

export type InboxMessageReplyTo = {
  message_id: number;
  preview: string;
  outbound: boolean;
};

export type InboxMessageDelivery = {
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  label: string;
};

export type InboxTimelineEvent = {
  id: string;
  created_at: string;
  label: string;
};

export type InboxMessage = {
  id: number;
  direction: string;
  body_text: string | null;
  message_type: string;
  created_at: string;
  is_ai: boolean;
  has_downloadable_media: boolean;
  reaction?: InboxMessageReaction | null;
  reply_to?: InboxMessageReplyTo | null;
  delivery?: InboxMessageDelivery | null;
  sender_label?: string | null;
  media_preview?: { url: string; mime?: string | null } | null;
  campaign_preview?: {
    headerText: string;
    headerMediaType: string | null;
    headerMediaUrl: string | null;
    bodyText: string;
    footerText: string;
    buttons: { type: string; text: string; url: string }[];
  } | null;
  campaign_id?: number | null;
  interactive_buttons?: { id: string; title: string }[];
};

export type InboxContact = {
  name: string | null;
  last_name: string | null;
  phone: string;
  email: string | null;
  dni: string | null;
  lead_score: number | null;
  lead_status: { id: number; slug: string; label: string } | null;
  segment_slugs: string[];
};

export type InboxMetaAd = {
  id: number;
  meta_source_id: string | null;
  display_name: string | null;
  ad_platform: string | null;
  headline: string | null;
  body: string | null;
  source_url: string | null;
};

export type InboxConversation = {
  id: number;
  phone: string;
  status: string;
  last_message_at: string | null;
  last_user_message_at: string | null;
  inbox_unread: boolean;
  archived: boolean;
  contact_id: number | null;
  wa_profile_name: string | null;
  meta_ctwa_ad_id: number | null;
  assigned_user_id: number | null;
  assigned_user_label: string | null;
  automation_touched_at: string | null;
};

export type InboxDetail = {
  conversation: InboxConversation;
  contact: InboxContact | null;
  meta_ad: InboxMetaAd | null;
  messages: InboxMessage[];
  events: InboxTimelineEvent[];
  tags: string[];
  can_reply: boolean;
  reply_blocked_reason: '24h' | 'bot_mode' | null;
  user_service_window_open: boolean;
  ai_area_enabled: boolean;
  can_assign_conversations: boolean;
};

export type EnsureConversationResult = {
  id: number;
};

export type ReplyResult = {
  messages: InboxMessage[];
};

export type UpdateConversationModeResult = {
  status: 'bot' | 'human';
};

export type ConversationAssignee = {
  id: number;
  label: string;
  email: string;
};

export type ConversationAssigneesResult = {
  assignees: ConversationAssignee[];
};

export type AssignConversationResult = {
  assigned_user_id: number | null;
  assigned_user_label: string | null;
};

export type ArchiveConversationResult = {
  archived: boolean;
};

export type MessageReactionResult = {
  ok: true;
  target_message_id: number;
  reaction: InboxMessageReaction | null;
};

export type InboxConversationUpdates = {
  messages: InboxMessage[];
  message_reactions: { id: number; reaction: InboxMessageReaction | null }[];
  message_deliveries: { id: number; delivery: InboxMessageDelivery | null }[];
  events: InboxTimelineEvent[];
  conversation: {
    last_message_at: string | null;
    last_user_message_at: string | null;
    status: string;
    inbox_unread: boolean;
    archived: boolean;
    assigned_user_id: number | null;
    assigned_user_label: string | null;
    automation_touched_at: string | null;
  };
  can_reply: boolean;
  reply_blocked_reason: '24h' | 'bot_mode' | null;
  user_service_window_open: boolean;
};
