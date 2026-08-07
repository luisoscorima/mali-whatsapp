import type { TemplateDisplayContent } from './template-display.util';
import type { TemplateBuilderPayload } from './template-builder.util';

export type TemplateListItem = {
  id: number;
  name: string;
  language: string;
  category: string | null;
  status: string;
  rejection_reason: string | null;
  submitted_at: string | null;
  synced_at: string;
  active: boolean;
};

export type TemplateUsageMassCampaign = {
  id: number;
  status: string;
  segment: string;
  total_recipients: number;
  created_at: string;
  scheduled_at: string | null;
};

export type TemplateUsageLinkedFlow = {
  id: number;
  name: string;
  status: string;
  trigger_payload: string;
  button_index: number | null;
};

export type TemplateUsage = {
  mass_campaigns: TemplateUsageMassCampaign[];
  direct_sends_count: number;
  linked_flows: TemplateUsageLinkedFlow[];
};

export type TemplateDetail = TemplateListItem & {
  meta_id: string | null;
  display: TemplateDisplayContent;
  can_edit: boolean;
  builder: TemplateBuilderPayload;
  usage: TemplateUsage;
};

export type TemplateSyncResult = {
  count: number;
};

export type TemplateCreateResult = {
  id: number;
  status: string;
};

export type TemplateValidateResult = {
  valid: true;
};

export type { TemplateDefinition } from './template-definition.util';
