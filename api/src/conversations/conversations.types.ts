export type InboxChatFilter = 'all' | 'unread' | 'bot' | 'human';

export type InboxSegmentOption = {
  slug: string;
  label: string;
  color_key: string;
};

export type InboxListItem = {
  id: number;
  phone: string;
  last_message_at: string | null;
  inbox_unread: boolean;
  conversation_status: string | null;
  contact_name: string;
  contact_lead_score: number | null;
  contact_segment_slugs: string[];
  preview: string;
  conversation_tags: string[];
  is_virtual: boolean;
  contact_id: number | null;
  matched_message_id: number | null;
};

export type InboxListResult = {
  items: InboxListItem[];
  unread_count: number;
  ai_area_enabled: boolean;
  segments: InboxSegmentOption[];
  filters: {
    q: string;
    chat: InboxChatFilter;
    segment_slugs: string[];
    include_none: boolean;
  };
};

export type InboxMessage = {
  id: number;
  direction: string;
  body_text: string | null;
  message_type: string;
  created_at: string;
  is_ai: boolean;
  has_downloadable_media: boolean;
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
};

export type InboxContact = {
  name: string | null;
  last_name: string | null;
  phone: string;
  lead_score: number | null;
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
  contact_id: number | null;
  meta_ctwa_ad_id: number | null;
};

export type InboxDetail = {
  conversation: InboxConversation;
  contact: InboxContact | null;
  meta_ad: InboxMetaAd | null;
  messages: InboxMessage[];
  tags: string[];
  can_reply: boolean;
  reply_blocked_reason: '24h' | 'bot_mode' | null;
  user_service_window_open: boolean;
  ai_area_enabled: boolean;
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

export type InboxConversationUpdates = {
  messages: InboxMessage[];
  conversation: {
    last_message_at: string | null;
    last_user_message_at: string | null;
    status: string;
    inbox_unread: boolean;
  };
  can_reply: boolean;
  reply_blocked_reason: '24h' | 'bot_mode' | null;
  user_service_window_open: boolean;
};
