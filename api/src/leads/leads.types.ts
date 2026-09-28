export const LEAD_CHANNELS = [
  'meta_lead_form',
  'meta_ctwa',
  'widget',
  'tiktok',
  'import',
  'organic_wa',
  'mali_one_link',
  'other',
] as const;

export type LeadChannel = (typeof LEAD_CHANNELS)[number];

export type LeadStatusSeed = {
  slug: string;
  label: string;
  sort_order: number;
  is_default: boolean;
  is_terminal: boolean;
};

/** Otras áreas. Educación usa EDUCATION_LEAD_STATUSES. */
export const DEFAULT_LEAD_STATUSES: LeadStatusSeed[] = [
  { slug: 'nuevo', label: 'Nuevo', sort_order: 0, is_default: true, is_terminal: false },
  { slug: 'contactado', label: 'Contactado', sort_order: 10, is_default: false, is_terminal: false },
  { slug: 'calificado', label: 'Calificado', sort_order: 20, is_default: false, is_terminal: false },
  { slug: 'convertido', label: 'Convertido', sort_order: 30, is_default: false, is_terminal: true },
  { slug: 'perdido', label: 'Perdido', sort_order: 40, is_default: false, is_terminal: true },
];

export const EDUCATION_LEAD_AREAS = ['educacion', 'educacion_ca', 'educacion_ep'] as const;

/** Camino de inscripción y luego los desvíos. El asesor elige una. */
export const EDUCATION_LEAD_STATUSES: LeadStatusSeed[] = [
  { slug: 'por_contactar', label: 'Por contactar', sort_order: 0, is_default: true, is_terminal: false },
  { slug: 'contactado', label: 'Contactado', sort_order: 10, is_default: false, is_terminal: false },
  { slug: 'evaluando', label: 'Evaluando', sort_order: 20, is_default: false, is_terminal: false },
  { slug: 'promesa', label: 'Promesa', sort_order: 30, is_default: false, is_terminal: false },
  { slug: 'venta_exitosa', label: 'Venta exitosa', sort_order: 40, is_default: false, is_terminal: true },
  { slug: 'no_contesta', label: 'No contesta', sort_order: 50, is_default: false, is_terminal: false },
  { slug: 'no_interesado', label: 'No interesado', sort_order: 60, is_default: false, is_terminal: true },
  { slug: 'perdido', label: 'Perdido', sort_order: 70, is_default: false, is_terminal: true },
];

/** Slugs viejos de Educación: el contacto pasa al estado nuevo y el viejo queda inactivo. */
export const EDUCATION_LEGACY_STATUS_SLUGS: Record<string, string> = {
  nuevo: 'por_contactar',
  calificado: 'evaluando',
  convertido: 'venta_exitosa',
};

export type ContactIdentityInput = {
  phone?: string | null;
  whatsapp_user_id?: string | null;
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
  whatsapp_user_id?: string | null;
  dni?: string | null;
  email?: string | null;
  conversation_id?: number | null;
  first_seen_at?: Date;
  last_seen_at?: Date;
  contact?: ContactIdentityInput;
};
