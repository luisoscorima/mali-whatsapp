export const BUSINESS_AREAS = [
  'ti',
  'pam',
  'patronato',
  'educacion',
  'educacion_ca',
  'educacion_ep',
] as const;

export type BusinessArea = (typeof BUSINESS_AREAS)[number];

export const AREA_LABELS: Record<BusinessArea, string> = {
  ti: 'TI (dev)',
  pam: 'PAM',
  patronato: 'Patronato',
  educacion: 'Educación',
  educacion_ca: 'Educación CA',
  educacion_ep: 'Educación EP',
};

export function normalizeArea(area: unknown): BusinessArea {
  const value = String(area ?? '')
    .trim()
    .toLowerCase();
  if ((BUSINESS_AREAS as readonly string[]).includes(value)) {
    return value as BusinessArea;
  }
  return 'ti';
}

export function isValidBusinessArea(area: unknown): area is BusinessArea {
  const value = String(area ?? '')
    .trim()
    .toLowerCase();
  return (BUSINESS_AREAS as readonly string[]).includes(value);
}

export function isValidMaliEmail(email: string): boolean {
  return /^[^\s@]+@mali\.pe$/i.test(String(email || '').trim());
}

export function normalizeEmail(email: unknown): string {
  return String(email ?? '')
    .trim()
    .toLowerCase();
}
