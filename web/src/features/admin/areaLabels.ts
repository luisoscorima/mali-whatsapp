export const AREA_OPTIONS = [
  { slug: 'ti', label: 'TI (dev)' },
  { slug: 'pam', label: 'PAM' },
  { slug: 'patronato', label: 'Patronato' },
  { slug: 'educacion', label: 'Educación' },
] as const

export const CANONICAL_AREA_OPTIONS = [
  { slug: 'ti', label: 'TI (dev)' },
  { slug: 'pam', label: 'PAM' },
  { slug: 'patronato', label: 'Patronato' },
  { slug: 'educacion', label: 'Educación' },
] as const

export const EDUCATION_CATEGORY_OPTIONS = [
  { slug: 'general', label: 'General' },
  { slug: 'ca', label: 'Cursos de Arte' },
  { slug: 'ep', label: 'Extensión Profesional' },
] as const

export function areaLabel(slug: string): string {
  return AREA_OPTIONS.find((item) => item.slug === slug)?.label ?? slug
}
