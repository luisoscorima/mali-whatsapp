// Education workflows remain domain-specific; tenant filtering is shared.
export { conversationAreaPredicate, contactAreaPredicate, visibleConversationWhere } from './business-scope';

export const EDUCATION_AREA_SLUGS = [
  'educacion',
  'educacion_ca',
  'educacion_ep',
] as const;

export type EducationProgram = 'ca' | 'ep';

export function isEducationAreaSlug(area: unknown): boolean {
  const value = String(area ?? '')
    .trim()
    .toLowerCase();
  return (EDUCATION_AREA_SLUGS as readonly string[]).includes(value);
}

export function educationProgramOf(area: unknown): EducationProgram | null {
  const value = String(area ?? '')
    .trim()
    .toLowerCase();
  if (value === 'educacion_ca' || value === 'ca') return 'ca';
  if (value === 'educacion_ep' || value === 'ep') return 'ep';
  return null;
}

/** Lectura de Educación: las tres áreas históricas, y el programa si el alias lo trae. */
export function educationReadScope(area: unknown): {
  areas: string[];
  program: EducationProgram | null;
} {
  const selected = String(area ?? 'all')
    .trim()
    .toLowerCase();
  if (
    selected !== 'all' &&
    selected !== 'educacion' &&
    !isEducationAreaSlug(selected) &&
    selected !== 'ca' &&
    selected !== 'ep'
  ) {
    return { areas: [selected], program: null };
  }
  return {
    areas: [...EDUCATION_AREA_SLUGS],
    program: educationProgramOf(selected),
  };
}

