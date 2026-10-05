/** Calificación de lead: 1 Bajo · 2 Medio · 3 Alto (null = sin calificar). */

export const LEAD_SCORE_LABELS = {
  1: 'Bajo',
  2: 'Medio',
  3: 'Alto',
} as const;

export type LeadScoreValue = keyof typeof LEAD_SCORE_LABELS;

export function isValidLeadScore(n: number): n is LeadScoreValue {
  return n === 1 || n === 2 || n === 3;
}

export function formatLeadScoreLabel(
  score: number | null | undefined,
): string {
  if (score == null) return '';
  const n = Number(score);
  if (isValidLeadScore(n)) return LEAD_SCORE_LABELS[n];
  // Timeline/auditoría anteriores a la escala 1–3
  if (n === 4 || n === 5) return LEAD_SCORE_LABELS[3];
  return '';
}

/** Remapea estrellas históricas 1–5 → escala 1–3. */
export function remapLegacyLeadScore(
  score: number | null | undefined,
): LeadScoreValue | null {
  if (score == null) return null;
  const n = Number(score);
  if (!Number.isInteger(n)) return null;
  if (n <= 0) return null;
  if (n <= 2) return 1;
  if (n === 3) return 2;
  if (n >= 4) return 3;
  return null;
}
