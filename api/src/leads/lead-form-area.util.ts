import { BadRequestException } from '@nestjs/common';
import { businessReadScope, requireBusinessArea, type BusinessArea } from '../config/areas';

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

/** Área canónica y categoría. Un alias educacion_ca/ep queda como Educación + CA/EP. */
export function writeFormRoute(
  areaInput: string,
  categoryInput?: string | null,
): { area: string; program_key: string | null } {
  const scope = businessReadScope(requireBusinessArea(areaInput));
  if (scope.canonicalArea !== 'educacion') {
    return { area: scope.canonicalArea, program_key: null };
  }
  if (scope.program) return { area: 'educacion', program_key: scope.program };
  const category = String(categoryInput ?? '').trim().toLowerCase();
  if (!category || category === 'general') {
    return { area: 'educacion', program_key: null };
  }
  if (!/^[a-z][a-z0-9_]{0,9}$/.test(category)) {
    throw new BadRequestException('Categoría no válida');
  }
  return { area: 'educacion', program_key: category };
}

export function presentFormRoute<T extends { area: string; program_key?: string | null }>(
  row: T,
): T & { category: string | null } {
  const scope = businessReadScope(requireBusinessArea(row.area));
  if (scope.canonicalArea !== 'educacion') {
    return { ...row, area: scope.canonicalArea, category: null };
  }
  return {
    ...row,
    area: 'educacion',
    category: scope.program || String(row.program_key || '').trim().toLowerCase() || 'general',
  };
}
