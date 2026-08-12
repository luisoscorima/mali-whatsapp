export const ALLOWED_ATTR_KEY = /^[a-z0-9_]{1,64}$/;

export const FIELD_TYPES = ['text', 'number', 'date', 'select'] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

const MAX_OPTIONS = 50;
const MAX_OPTION_LENGTH = 120;

export function normalizeAttrSlug(raw: unknown): string {
  return String(raw ?? '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .slice(0, 64);
}

export function normalizeFieldType(raw: unknown): FieldType {
  const value = String(raw ?? 'text')
    .trim()
    .toLowerCase();
  return (FIELD_TYPES as readonly string[]).includes(value)
    ? (value as FieldType)
    : 'text';
}

export function normalizeOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const value = String(item ?? '')
      .trim()
      .slice(0, MAX_OPTION_LENGTH);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

export function parseStoredOptions(raw: unknown): string[] | null {
  if (raw == null) return null;
  const options = normalizeOptions(raw);
  return options.length > 0 ? options : null;
}

export type AttributeDefinition = {
  id: number;
  segment_slug: string | null;
  slug: string;
  label: string;
  field_type: string;
  options: string[] | null;
  sort_order: number;
  required: boolean;
  active: boolean;
  /** Contactos del área con valor no vacío en este slug. */
  usage_count: number;
};
