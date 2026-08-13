export const LEAD_CHANNELS = [
  'meta_lead_form',
  'meta_ctwa',
  'widget',
  'tiktok',
  'import',
  'manual',
  'organic_wa',
  'other',
] as const;

export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export const DEFAULT_LEAD_STATUSES: Array<{
  slug: string;
  label: string;
  sort_order: number;
  is_default: boolean;
  is_terminal: boolean;
}> = [
  { slug: 'nuevo', label: 'Nuevo', sort_order: 0, is_default: true, is_terminal: false },
  { slug: 'contactado', label: 'Contactado', sort_order: 10, is_default: false, is_terminal: false },
  { slug: 'calificado', label: 'Calificado', sort_order: 20, is_default: false, is_terminal: false },
  { slug: 'convertido', label: 'Convertido', sort_order: 30, is_default: false, is_terminal: true },
  { slug: 'perdido', label: 'Perdido', sort_order: 40, is_default: false, is_terminal: true },
];

export type ContactIdentityInput = {
  phone?: string | null;
  dni?: string | null;
  email?: string | null;
  name?: string | null;
  last_name?: string | null;
  opt_in?: boolean;
  opt_in_email?: boolean;
};

export type UpsertOriginInput = {
  area: string;
  channel: LeadChannel;
  external_id: string;
  source_key?: string | null;
  source_label?: string | null;
  payload?: unknown;
  phone?: string | null;
  dni?: string | null;
  email?: string | null;
  conversation_id?: number | null;
  contact?: ContactIdentityInput;
};
