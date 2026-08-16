export const SEGMENT_NONE_TOKEN = '__none__';

export type SegmentListFilter = {
  slugs: string[];
  includeNone: boolean;
};

export type ContactListItem = {
  id: number;
  name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  dni: string | null;
  opt_in: boolean;
  opt_in_email: boolean;
  active: boolean;
  replaced_by_contact_id: number | null;
  replaced_at: string | null;
  replacement_reason: string | null;
  created_at: string;
  segment_slugs: string[];
};

export type ContactsListResult = {
  items: ContactListItem[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};

export type AttributeFilterOption = {
  slug: string;
  label: string;
  segment_slug: string | null;
};

export type AttributeFieldDefinition = {
  id: number;
  segment_slug: string | null;
  slug: string;
  label: string;
  field_type: string;
  options: string[] | null;
  sort_order: number;
  required: boolean;
};

export type ContactLeadStatus = {
  id: number;
  slug: string;
  label: string;
};

export type ContactDetail = {
  id: number;
  name: string;
  last_name: string;
  phone: string | null;
  email: string | null;
  dni: string | null;
  opt_in: boolean;
  opt_in_email: boolean;
  active: boolean;
  replaced_by_contact_id: number | null;
  replaced_at: string | null;
  replacement_reason: string | null;
  created_at: string;
  segment_slugs: string[];
  lead_status_id: number | null;
  lead_status: ContactLeadStatus | null;
  attributes: Record<string, string>;
  attribute_definitions: AttributeFieldDefinition[];
};

export type ContactsFilterOptions = {
  segments: Array<{
    id: number;
    slug: string;
    label: string;
    color_key: string;
  }>;
  attribute_filters: AttributeFilterOption[];
  attribute_definitions: AttributeFieldDefinition[];
};

export type ListContactsParams = {
  page?: number;
  limit?: number;
  q?: string;
  segment?: string[];
  show_replaced?: boolean;
  attr_key?: string;
  attr_value?: string;
};

export type ContactsImportResult = {
  imported: number;
  errors: number;
  error_samples: Array<{ line: number; message: string }>;
  duplicate_phones_in_file: number;
  duplicate_rows_in_file: number;
  duplicate_phone_examples: string[];
};

export type { ContactSummary } from './contact-analytics.util';
