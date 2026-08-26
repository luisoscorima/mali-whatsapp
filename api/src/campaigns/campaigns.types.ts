import type { CampaignAnalytics, FailedLogRow, MetricCard } from './campaign-analytics.util';
import type { CampaignLogRow } from './campaign-analytics.util';
import type { CampaignRetryStats } from './campaign-retry-stats.util';
import type { CampaignResponderMetrics } from './campaign-responders.util';
import type { CampaignMessagePreview } from './campaign-message-preview.util';
import type { CampaignParamSummaryItem } from './campaign-param-summary.util';

export type CampaignListItem = {
  id: number;
  segment: string;
  segment_display: string;
  template_name: string;
  message_text: string;
  status: string;
  total_recipients: number;
  created_at: string;
  scheduled_at: string | null;
  first_send_at: string | null;
  log_count: number;
  salida_ok: number;
  delivered_count: number;
  read_count: number;
  failed_count: number;
  sent_percent: number | null;
  sent_ratio: string;
  send_mode: string;
};

export type CampaignSummaryMonthlyPoint = {
  monthKey: string;
  label: string;
  campaignsCount: number;
  costUsd: number;
};

export type CampaignSummary = {
  business: MetricCard[];
  results: MetricCard[];
  hint: string;
  campaignsCount: number;
  monthlySeries?: CampaignSummaryMonthlyPoint[];
};

export type CampaignRecipientPreview = {
  id: number;
  name: string;
  phone: string;
  service_window_open: boolean;
};

export type RecipientsPreviewResult = {
  contacts: CampaignRecipientPreview[];
  total: number;
  exclude_open_service_window: boolean;
};

export type SendCampaignResult = {
  kind: 'sent';
  campaignId: number;
  redirect: string;
  status: string;
  totalRecipients: number;
  isScheduled: boolean;
};

export type SendCampaignMissingParams = {
  kind: 'missing_params';
  code: 'MISSING_TEMPLATE_PARAMS';
  total: number;
  ready: number;
  missing: number;
  missingContactIds: number[];
  byField: Array<{ source: string; label: string; count: number }>;
  sample: Array<{
    id: number;
    phone: string;
    name: string;
    missing: string[];
  }>;
};

export type SendCampaignOutcome = SendCampaignResult | SendCampaignMissingParams;

export type CampaignRetryActionResult = {
  retried: number;
  recovered: number;
  stillFailed: number;
  skipped: boolean;
  error?: string;
};

export type CampaignExcludedContact = {
  id: number;
  name: string;
  last_name: string;
  phone: string | null;
};

export type CampaignDetail = {
  id: number;
  segment: string;
  segment_display: string;
  template_name: string;
  message_text: string;
  image_url: string | null;
  status: string;
  total_recipients: number;
  created_at: string;
  scheduled_at: string | null;
  cost_amount: string | null;
  cost_currency: string | null;
  cost_source: string | null;
  cost_is_estimated: boolean;
  cost_synced_at: string | null;
  campaign_payload: unknown;
  analytics: CampaignAnalytics;
  failed_logs: FailedLogRow[];
  logs: CampaignLogRow[];
  retry_stats: CampaignRetryStats;
  responder_metrics: CampaignResponderMetrics;
  template_id: number | null;
  message_preview: CampaignMessagePreview | null;
  param_summary: CampaignParamSummaryItem[];
  exclude_segment_slugs: string[];
  exclude_contact_ids: number[];
  exclude_contacts: CampaignExcludedContact[];
  first_send_at: string | null;
};
