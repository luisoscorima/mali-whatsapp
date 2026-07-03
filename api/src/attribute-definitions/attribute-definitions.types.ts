export const ALLOWED_ATTR_KEY = /^[a-z0-9_]{1,64}$/;

export const FIELD_TYPES = ['text', 'number', 'date'] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

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

export type AttributeDefinition = {
  id: number;
  segment_slug: string | null;
  slug: string;
  label: string;
  field_type: string;
  sort_order: number;
  required: boolean;
  active: boolean;
};
