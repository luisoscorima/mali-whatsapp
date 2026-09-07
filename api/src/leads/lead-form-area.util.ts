import type { BusinessArea } from '../config/areas';

/**
 * Infere área Mali desde el nombre del Instant Form (Meta Lead Ads).
 * - «Cursos de Arte…» / «[FORM CA]» / prefijo «CA …» → educacion_ca
 * - «[FORM EP]» / «FORM EP» → educacion_ep
 * - resto → educacion
 */
export function inferAreaFromFormName(
  formName: string | null | undefined,
): BusinessArea {
  const name = String(formName ?? '')
    .trim()
    .toLowerCase();
  if (!name) return 'educacion';

  if (name.includes('[form ep]') || /\bform\s*ep\b/.test(name)) {
    return 'educacion_ep';
  }
  if (
    name.includes('[form ca]') ||
    /\bform\s*ca\b/.test(name) ||
    name.includes('cursos de arte') ||
    /^ca[\s-]/.test(name)
  ) {
    return 'educacion_ca';
  }
  return 'educacion';
}
