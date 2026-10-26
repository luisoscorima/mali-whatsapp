// Education workflows remain domain-specific; tenant filtering is shared.
export { conversationAreaPredicate, contactAreaPredicate, inboxConversationPredicate, visibleConversationWhere } from './business-scope';

export const EDUCATION_AREA_SLUGS = [
  'educacion',
  'educacion_ca',
  'educacion_ep',
] as const;

const OTHER_AREAS = ['ti', 'pam', 'patronato'];

export function isEducationAreaSlug(area: unknown): boolean {
  const value = String(area ?? '')
    .trim()
    .toLowerCase();
  return (EDUCATION_AREA_SLUGS as readonly string[]).includes(value);
}

/** Categoría de Educación. Los alias educacion_ca y educacion_ep siguen siendo ca y ep. */
export function educationProgramOf(area: unknown): string | null {
  const value = String(area ?? '')
    .trim()
    .toLowerCase();
  if (!value || value === 'all' || value === 'educacion' || value === 'general') return null;
  if (value === 'educacion_ca' || value === 'ca') return 'ca';
  if (value === 'educacion_ep' || value === 'ep') return 'ep';
  const prefixed = value.match(/^educacion_([a-z][a-z0-9_]{0,9})$/);
  if (prefixed) return prefixed[1];
  if (/^[a-z][a-z0-9_]{0,9}$/.test(value) && !OTHER_AREAS.includes(value)) return value;
  return null;
}

/** Lectura de Educación: las áreas históricas, y la categoría si el alias o el identificador la traen. */
export function educationReadScope(area: unknown): {
  areas: string[];
  program: string | null;
} {
  const selected = String(area ?? 'all')
    .trim()
    .toLowerCase();
  const program = educationProgramOf(selected);
  const family = selected === 'all'
    || selected === 'educacion'
    || isEducationAreaSlug(selected)
    || program != null;
  if (!family) return { areas: [selected], program: null };
  return { areas: [...EDUCATION_AREA_SLUGS], program };
}

