import { Prisma } from '@prisma/client';
import { readSessionWindowMs } from '../campaigns/campaign-conversation-window.util';
import type { SegmentListFilter } from '../contacts/contacts.types';
import type {
  InboxChatFilter,
  InboxWindowMaxFilter,
} from './conversations.types';

export const INBOX_WINDOW_MAX_BUCKETS = [2, 6, 12, 24] as const;

export function parseInboxChatFilter(raw?: string): InboxChatFilter {
  const value = String(raw ?? '').trim().toLowerCase();
  if (
    value === 'unread' ||
    value === 'bot' ||
    value === 'human' ||
    value === 'mine' ||
    value === 'unassigned' ||
    value === 'new'
  ) {
    return value;
  }
  return 'all';
}

/** Buckets ≤Nh restantes (ceil de la UI). null = sin filtro. */
export function parseInboxWindowMaxFilter(
  raw?: string,
): InboxWindowMaxFilter {
  const n = Number(String(raw ?? '').trim());
  if (
    INBOX_WINDOW_MAX_BUCKETS.includes(
      n as (typeof INBOX_WINDOW_MAX_BUCKETS)[number],
    )
  ) {
    return n as InboxWindowMaxFilter;
  }
  return null;
}

/**
 * Chats con ventana abierta y horas restantes (ceil) ≤ maxHours.
 * remainingMs = sessionWindow - (now - last_user) ∈ (0, maxHours·1h].
 */
export function buildWindowMaxFilterSql(
  windowMax: InboxWindowMaxFilter,
): Prisma.Sql {
  if (windowMax == null) return Prisma.empty;
  const sessionWindowMs = readSessionWindowMs();
  const maxRemainingMs = windowMax * 60 * 60 * 1000;
  const minAgeMs = Math.max(0, sessionWindowMs - maxRemainingMs);
  return Prisma.sql` AND c.last_user_message_at IS NOT NULL
    AND c.last_user_message_at > NOW() - (${sessionWindowMs}::bigint * INTERVAL '1 millisecond')
    AND c.last_user_message_at <= NOW() - (${minAgeMs}::bigint * INTERVAL '1 millisecond')`;
}

export function parseSegmentQueryParam(
  raw: string | string[] | undefined,
): string[] {
  if (!raw) return [];
  return (Array.isArray(raw) ? raw : [raw])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

export function buildConversationSegmentSql(
  filter: SegmentListFilter,
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (filter.slugs.length > 0) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM contact_segments cseg
      WHERE cseg.contact_id = ct.id AND cseg.segment_slug = ANY(${filter.slugs}::varchar[])
    )`);
  }
  if (filter.includeNone) {
    clauses.push(Prisma.sql`c.contact_id IS NULL`);
  }
  if (!clauses.length) return Prisma.empty;
  return Prisma.sql` AND (${Prisma.join(clauses, ' OR ')})`;
}

export function buildContactSegmentSql(filter: SegmentListFilter): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (filter.slugs.length > 0) {
    clauses.push(Prisma.sql`EXISTS (
      SELECT 1 FROM contact_segments csf
      WHERE csf.contact_id = ct.id AND csf.segment_slug = ANY(${filter.slugs}::varchar[])
    )`);
  }
  if (filter.includeNone) {
    clauses.push(Prisma.sql`NOT EXISTS (
      SELECT 1 FROM contact_segments csn
      WHERE csn.contact_id = ct.id
    )`);
  }
  if (!clauses.length) return Prisma.empty;
  return Prisma.sql` AND (${Prisma.join(clauses, ' OR ')})`;
}
