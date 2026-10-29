import { EDUCATION_LEAD_WINDOW_MS } from './education-lead-classification.util';

export const EDUCATION_ATTENTION_AREAS = [
  'educacion',
  'educacion_ca',
  'educacion_ep',
] as const;

export type EducationAttentionArea = (typeof EDUCATION_ATTENTION_AREAS)[number];

export const EDUCATION_COMMERCIAL_CHANNELS = new Set([
  'meta_lead_form',
  'meta_ctwa',
  'widget',
  'tiktok',
  'mali_one_link',
  'import',
]);

export const ATTENTION_V1_SETTING_KEY = 'leads.attention_v1';

export function isEducationAttentionArea(area: string): boolean {
  return (EDUCATION_ATTENTION_AREAS as readonly string[]).includes(area);
}

export function isCommercialLeadChannel(channel?: string | null): boolean {
  return EDUCATION_COMMERCIAL_CHANNELS.has(String(channel ?? '').trim());
}

/** Area slug used to store General (program_id null) cycles. */
export function generalCycleArea(area: string): string {
  if (area === 'educacion_ca' || area === 'educacion_ep') return area;
  return 'educacion';
}

/** Category match without open/closed filter (for historical lookups). */
export function exactCategoryCycleWhere(input: {
  personId: number;
  area: string;
  programId?: number | null;
}) {
  const programId = input.programId ?? null;
  if (programId != null) {
    const legacyArea =
      input.area === 'educacion_ca' || input.area === 'educacion_ep'
        ? input.area
        : null;
    return {
      person_id: input.personId,
      OR: [
        { program_id: programId },
        ...(legacyArea
          ? [{ program_id: null as number | null, area: legacyArea }]
          : []),
      ],
    };
  }
  return {
    person_id: input.personId,
    program_id: null,
    area: generalCycleArea(input.area),
  };
}

/**
 * Exact open-cycle match by person + category.
 * Specific program: only that program_id (plus legacy null+educacion_ca/ep).
 * General: program_id IS NULL and explicit General area (never CA/EP).
 */
export function exactOpenCycleWhere(input: {
  personId: number;
  area: string;
  programId?: number | null;
}) {
  return {
    ...exactCategoryCycleWhere(input),
    closed_at: null,
  };
}

export function inactivityDeadlineFrom(
  from: Date,
  windowMs = EDUCATION_LEAD_WINDOW_MS,
): Date {
  return new Date(from.getTime() + windowMs);
}

export function isCycleOpen(cycle: {
  closed_at?: Date | null;
  lead_status?: { is_terminal?: boolean | null } | null;
}): boolean {
  if (cycle.closed_at) return false;
  if (cycle.lead_status?.is_terminal) return false;
  return true;
}

export function categorySlugOfCycle(input: {
  program_id?: number | null;
  program?: { slug?: string | null } | null;
}): string {
  if (input.program_id == null) return 'general';
  return String(input.program?.slug ?? '').trim() || 'general';
}
