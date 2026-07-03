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
};

export type TemplateDetail = TemplateListItem & {
  meta_id: string | null;
  display: TemplateDisplayContent;
  can_edit: boolean;
  builder: TemplateBuilderPayload;
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
