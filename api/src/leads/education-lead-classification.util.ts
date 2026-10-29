export const EDUCATION_LEAD_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

const TERMINAL_SLUGS = new Set([
  'convertido',
  'venta_exitosa',
  'perdido',
  'no_interesado',
  'vencido',
]);

export function isTerminalEducationStatusSlug(slug?: string | null): boolean {
  const status = slug?.trim().toLowerCase().replace(/[\s-]+/g, '_') ?? '';
  return TERMINAL_SLUGS.has(status);
}

/**
 * Classifies a commercial intake against the previous cycle in the same category.
 * Closed/terminal previous cycles reopen as a new opportunity for explicit commercial entries.
 * Organic/ambiguous post-close handling is done by the caller (do not open automatically).
 */
export function classifyEducationIntake(input: {
  occurredAt: Date;
  previousInteractionAt?: Date | null;
  previousStatusSlug?: string | null;
  previousClosedAt?: Date | null;
}): {
  classification: 'new' | 'duplicate' | 'conflict';
  assignmentRule: 'new_number' | 'same_advisor' | 'reassignable' | 'conflict';
  conflictReason: string | null;
} {
  const previousClosed = Boolean(input.previousClosedAt)
    || isTerminalEducationStatusSlug(input.previousStatusSlug);
  const gap = input.previousInteractionAt
    ? input.occurredAt.getTime() - input.previousInteractionAt.getTime()
    : Infinity;

  if (!input.previousInteractionAt) {
    return { classification: 'new', assignmentRule: 'new_number', conflictReason: null };
  }

  if (previousClosed) {
    return { classification: 'new', assignmentRule: 'reassignable', conflictReason: null };
  }

  if (gap > EDUCATION_LEAD_WINDOW_MS) {
    return { classification: 'new', assignmentRule: 'reassignable', conflictReason: null };
  }

  return { classification: 'duplicate', assignmentRule: 'same_advisor', conflictReason: null };
}
