import { ALLOWED_ATTR_KEY } from '../attribute-definitions/attribute-definitions.types';

export type AttributeFieldDefinition = {
  id: number;
  segment_slug: string | null;
  slug: string;
  label: string;
  field_type: string;
  sort_order: number;
  required: boolean;
};

export function getApplicableAttributeDefinitions(
  all: AttributeFieldDefinition[],
  segmentSlugs: string[],
): AttributeFieldDefinition[] {
  const segSet = new Set(
    segmentSlugs.map((s) => String(s ?? '').trim()).filter(Boolean),
  );
  const bySlug = new Map<string, AttributeFieldDefinition>();

  for (const row of all) {
    if (!row.segment_slug) {
      bySlug.set(row.slug, row);
    }
  }
  for (const row of all) {
    if (row.segment_slug && segSet.has(row.segment_slug)) {
      bySlug.set(row.slug, row);
    }
  }

  return [...bySlug.values()].sort((a, b) => {
    const ao = Number(a.sort_order) || 0;
    const bo = Number(b.sort_order) || 0;
    if (ao !== bo) return ao - bo;
    return String(a.label).localeCompare(String(b.label));
  });
}

export function normalizeAttributesInput(
  raw: Record<string, unknown> | undefined,
): Record<string, string> {
  if (!raw || typeof raw !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = String(key ?? '')
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '_');
    if (!ALLOWED_ATTR_KEY.test(k)) continue;
    out[k] = String(value ?? '').trim().slice(0, 500);
  }
  return out;
}

export function filterAttributesForDefinitions(
  attributes: Record<string, string>,
  definitions: AttributeFieldDefinition[],
): Record<string, string> {
  const allowed = new Set(definitions.map((d) => d.slug));
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes)) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

export function validateRequiredAttributes(
  attributes: Record<string, string>,
  definitions: AttributeFieldDefinition[],
): string | null {
  for (const def of definitions) {
    if (!def.required) continue;
    const value = String(attributes[def.slug] ?? '').trim();
    if (!value) {
      return `El atributo «${def.label}» es obligatorio`;
    }
  }
  return null;
}
