export const AREA_OPTIONS = [
  { slug: 'ti', label: 'TI (dev)' },
  { slug: 'pam', label: 'PAM' },
  { slug: 'patronato', label: 'Patronato' },
  { slug: 'educacion', label: 'Educación' },
  { slug: 'educacion_ca', label: 'Educación CA' },
  { slug: 'educacion_ep', label: 'Educación EP' },
] as const

export const CANONICAL_AREA_OPTIONS = [
  { slug: 'ti', label: 'TI (dev)' },
  { slug: 'pam', label: 'PAM' },
  { slug: 'patronato', label: 'Patronato' },
  { slug: 'educacion', label: 'Educación' },
] as const

export const EDUCATION_CATEGORY_OPTIONS = [
  { slug: 'general', label: 'General' },
  { slug: 'ca', label: 'CA' },
  { slug: 'ep', label: 'EP' },
] as const

export function areaLabel(slug: string): string {
  return AREA_OPTIONS.find((item) => item.slug === slug)?.label ?? slug
}
