export const EDUCATION_LEAD_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

export function classifyEducationIntake(input: {
  occurredAt: Date;
  previousInteractionAt?: Date | null;
  previousStatusSlug?: string | null;
}): { classification: 'new' | 'duplicate' | 'conflict'; assignmentRule: 'new_number' | 'same_advisor' | 'reassignable' | 'conflict'; conflictReason: string | null } {
  const status = input.previousStatusSlug?.trim().toLowerCase().replace(/[\s-]+/g, '_') ?? '';
  const gap = input.previousInteractionAt
    ? input.occurredAt.getTime() - input.previousInteractionAt.getTime()
    : Infinity;
  if (status === 'convertido' || status === 'venta_exitosa') {
    return { classification: 'conflict', assignmentRule: 'conflict', conflictReason: 'estado_convertido' };
  }
  if (gap <= EDUCATION_LEAD_WINDOW_MS && status === 'no_interesado') {
    return { classification: 'conflict', assignmentRule: 'conflict', conflictReason: 'no_interesado_reciente' };
  }
  if (!input.previousInteractionAt) {
    return { classification: 'new', assignmentRule: 'new_number', conflictReason: null };
  }
  return gap > EDUCATION_LEAD_WINDOW_MS
    ? { classification: 'new', assignmentRule: 'reassignable', conflictReason: null }
    : { classification: 'duplicate', assignmentRule: 'same_advisor', conflictReason: null };
}
