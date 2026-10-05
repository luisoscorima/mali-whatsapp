/** Calificación de lead: 1 Bajo · 2 Medio · 3 Alto (null = sin calificar). */

export const LEAD_SCORE_OPTIONS = [
  { value: 1, label: 'Bajo' },
  { value: 2, label: 'Medio' },
  { value: 3, label: 'Alto' },
] as const

export type LeadScoreValue = (typeof LEAD_SCORE_OPTIONS)[number]['value']

export function leadScoreLabel(score: number | null | undefined): string {
  if (score == null) return ''
  const opt = LEAD_SCORE_OPTIONS.find((o) => o.value === score)
  if (opt) return opt.label
  // Residuos previos a la migración 1–5 → 1–3
  if (score === 4 || score === 5) return 'Alto'
  return ''
}

export function leadScoreTone(
  score: number,
): 'low' | 'mid' | 'high' | null {
  if (score === 1) return 'low'
  if (score === 2) return 'mid'
  if (score === 3 || score === 4 || score === 5) return 'high'
  return null
}
