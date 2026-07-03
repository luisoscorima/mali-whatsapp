import { SEGMENT_NONE_TOKEN, type SegmentListFilter } from './contacts.types';

export function escapeForLikePattern(value: string): string {
  return String(value).replace(/!/g, '!!').replace(/%/g, '!%').replace(/_/g, '!_');
}

export function parseSegmentListFilter(
  raw: string[] | undefined,
  slugSet: Set<string>,
): SegmentListFilter {
  const parts = (raw ?? []).map((item) => String(item ?? '').trim()).filter(Boolean);
  const slugs: string[] = [];
  const seen = new Set<string>();
  let includeNone = false;

  for (const part of parts) {
    if (part === SEGMENT_NONE_TOKEN) {
      includeNone = true;
    } else if (slugSet.has(part) && !seen.has(part)) {
      seen.add(part);
      slugs.push(part);
    }
  }

  return { slugs, includeNone };
}

export function hasActiveSegmentFilter(filter: SegmentListFilter): boolean {
  return filter.includeNone || filter.slugs.length > 0;
}
