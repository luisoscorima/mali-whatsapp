import { Prisma } from '@prisma/client';
import type { SegmentListFilter } from '../contacts/contacts.types';
import type { InboxChatFilter } from './conversations.types';

export function parseInboxChatFilter(raw?: string): InboxChatFilter {
  const value = String(raw ?? '').trim().toLowerCase();
  if (value === 'unread' || value === 'bot' || value === 'human') return value;
  return 'all';
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
