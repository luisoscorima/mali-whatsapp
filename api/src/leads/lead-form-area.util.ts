import type { BusinessArea } from '../config/areas';

/**
 * Infere área Mali desde el nombre del Instant Form (Meta Lead Ads).
 * - "Cursos de Arte…" → educacion_ca
 * - "[FORM EP]" / "FORM EP" → educacion_ep
 * - resto → educacion
 */
export function inferAreaFromFormName(formName: string | null | undefined): BusinessArea {
  const name = String(formName ?? '')
    .trim()
    .toLowerCase();
  if (!name) return 'educacion';

  if (name.startsWith('cursos de arte')) {
    return 'educacion_ca';
  }
  if (name.includes('[form ep]') || name.includes('form ep')) {
    return 'educacion_ep';
  }
  return 'educacion';
}
