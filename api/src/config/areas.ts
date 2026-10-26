import { BadRequestException } from '@nestjs/common';

/** Business slugs come from the catalog; these entries only bootstrap legacy installations/tests. */
export type BusinessArea = string;
export type BusinessScope = { canonicalArea: string; areas: string[]; program: string | null };
export type CatalogArea = { id: number; slug: string; label: string; active: boolean };
export type CatalogAlias = { alias: string; business_area_id: number; program_key: string | null; active: boolean };
const BOOTSTRAP_LABELS: Record<string, string> = {
  ti: 'TI (dev)', pam: 'PAM', patronato: 'Patronato', educacion: 'Educación',
  educacion_ca: 'Educación CA', educacion_ep: 'Educación EP',
};
// Preserve object references for existing consumers while refreshing atomically between requests.
export const BUSINESS_AREAS: BusinessArea[] = Object.keys(BOOTSTRAP_LABELS);
export const AREA_LABELS: Record<string, string> = { ...BOOTSTRAP_LABELS };
let scopes = new Map<string, { canonicalArea: string; program: string | null }>(
  BUSINESS_AREAS.map(slug => [slug, {
    canonicalArea: slug.startsWith('educacion_') ? 'educacion' : slug,
    program: slug === 'educacion_ca' ? 'ca' : slug === 'educacion_ep' ? 'ep' : null,
  }]),
);

export function setBusinessAreaCatalog(areas: CatalogArea[], aliases: CatalogAlias[]): void {
  const next = new Map<string, { canonicalArea: string; program: string | null }>();
  const labels: Record<string, string> = {};
  const active = new Map(areas.filter(a => a.active).map(a => [a.id, a]));
  for (const area of active.values()) {
    next.set(area.slug, { canonicalArea: area.slug, program: null });
    labels[area.slug] = area.label;
  }
  for (const alias of aliases) {
    const area = active.get(alias.business_area_id);
    if (!alias.active || !area || next.has(alias.alias)) continue;
    next.set(alias.alias, { canonicalArea: area.slug, program: alias.program_key });
    labels[alias.alias] = alias.program_key ? `${area.label} · ${alias.program_key.toUpperCase()}` : area.label;
  }
  if (!next.size) throw new Error('El catálogo no contiene áreas activas');
  scopes = next;
  BUSINESS_AREAS.splice(0, BUSINESS_AREAS.length, ...next.keys());
  for (const key of Object.keys(AREA_LABELS)) delete AREA_LABELS[key];
  Object.assign(AREA_LABELS, labels);
}

/** Unknown scopes fail closed; never silently route another tenant into TI. */
export function normalizeArea(area: unknown): BusinessArea {
  const value = String(area ?? '').trim().toLowerCase();
  return scopes.has(value) ? value : '';
}
export function isValidBusinessArea(area: unknown): area is BusinessArea {
  return Boolean(normalizeArea(area));
}
export function requireBusinessArea(area: unknown): BusinessArea {
  const value = normalizeArea(area);
  if (!value) throw new BadRequestException('Área desconocida o inactiva');
  return value;
}
export function businessReadScope(area: unknown): BusinessScope {
  const selected = requireBusinessArea(area);
  const scope = scopes.get(selected)!;
  return {
    ...scope,
    areas: [...scopes].filter(([, s]) => s.canonicalArea === scope.canonicalArea).map(([slug]) => slug),
  };
}
export function canonicalBusinessArea(area: unknown): string {
  return businessReadScope(area).canonicalArea;
}
export function canonicalBusinessAreas(): string[] {
  return [...new Set([...scopes.values()].map(s => s.canonicalArea))];
}
export function isValidMaliEmail(email: string): boolean {
  return /^[^\s@]+@mali\.pe$/i.test(String(email || '').trim());
}
export function normalizeEmail(email: unknown): string {
  return String(email ?? '').trim().toLowerCase();
}
