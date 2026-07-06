export const SEGMENT_SLUG_REGEX = /^[a-z0-9_]{1,50}$/;

export const SEGMENT_COLOR_KEYS = [
  'teal',
  'emerald',
  'cyan',
  'sky',
  'blue',
  'indigo',
  'violet',
  'fuchsia',
  'rose',
  'pink',
  'red',
  'orange',
  'amber',
  'lime',
  'slate',
] as const;

export type SegmentColorKey = (typeof SEGMENT_COLOR_KEYS)[number];

export function normalizeSegmentColorKey(raw: unknown): SegmentColorKey {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  return (SEGMENT_COLOR_KEYS as readonly string[]).includes(value)
    ? (value as SegmentColorKey)
    : 'teal';
}

export type SegmentDefinition = {
  id: number;
  slug: string;
  label: string;
  sort_order: number;
  color_key: string;
};

export type SegmentMember = {
  id: number;
  name: string;
  last_name: string;
  phone: string;
  segment_slugs: string[];
};

export type SegmentDetail = {
  segment: SegmentDefinition;
  members: SegmentMember[];
};
