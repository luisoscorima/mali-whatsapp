export type MetaCtwaAdRow = {
  id: number;
  meta_source_id: string;
  display_name: string | null;
  ad_platform: string;
  source_url: string | null;
  source_type: string | null;
  headline: string | null;
  body: string | null;
  lead_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
};

export type MetaCtwaAdListItem = MetaCtwaAdRow & {
  display_label: string;
  platform_label: string;
};

export type MetaCtwaAdDetail = {
  id: number;
  meta_source_id: string;
  display_name: string | null;
  ad_platform: string;
  source_url: string | null;
  source_type: string | null;
  headline: string | null;
  body: string | null;
  media_type: string | null;
  image_url: string | null;
  ctwa_clid: string | null;
  lead_count: number;
  first_seen_at: Date;
  last_seen_at: Date;
  referral_snapshot: unknown;
  display_label: string;
  platform_label: string;
};

export type MetaCtwaAdLead = {
  phone: string;
  first_message_at: Date;
  contact_name: string | null;
  contact_id: number | null;
  contact_email: string | null;
  lead_score: number | null;
  lead_status: { id: number; slug: string; label: string } | null;
  segment_slugs: string[];
  conversation_id: number;
  conversation_status: string | null;
  conversation_archived: boolean;
  last_message_at: Date | null;
  assigned_user: {
    id: number;
    email: string;
    name: string;
  } | null;
};

export function formatAdPlatformLabel(platform: string): string {
  if (platform === 'facebook') return 'Facebook';
  if (platform === 'instagram') return 'Instagram';
  return 'Meta';
}

export function adDisplayLabel(row: {
  display_name?: string | null;
  meta_source_id?: string | null;
}): string {
  const name = String(row.display_name ?? '').trim();
  if (name) return name;
  return String(row.meta_source_id ?? '').trim() || 'Anuncio';
}
