import type { TemplateDisplayContent } from './template-display.util';

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
};

export type TemplateSyncResult = {
  count: number;
};
