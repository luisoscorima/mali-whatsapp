import { Prisma } from '@prisma/client';
import { readSessionWindowMs } from '../campaigns/campaign-conversation-window.util';
import type { SegmentListFilter } from '../contacts/contacts.types';
import {
  addDaysYmd,
  getReportDisplayTimeZone,
  isYmdDate,
  todayYmdInDisplayTz,
} from '../reports/report-date-range.util';
import type {
  InboxChatFilter,
  InboxWindowMaxFilter,
} from './conversations.types';

export const INBOX_WINDOW_MAX_BUCKETS = [2, 6, 12, 24] as const;

export function parseInboxChatFilter(raw?: string): InboxChatFilter {
  const value = String(raw ?? '')
    .trim()
    .toLowerCase();
  // Legacy: «Nuevo» se unificó en «Sin asignar».
  if (value === 'new') return 'unassigned';
  if (
    value === 'unread' ||
    value === 'bot' ||
    value === 'human' ||
    value === 'mine' ||
    value === 'unassigned' ||
    value === 'unanswered' ||
    value === 'archived' ||
    value === 'archived_auto' ||
    value === 'archived_manual'
  ) {
    return value;
  }
  return 'all';
}

/** Vista Archivados (todos / auto / manual). */
export function isArchivedChatFilter(chat: InboxChatFilter): boolean {
  return (
    chat === 'archived' ||
    chat === 'archived_auto' ||
    chat === 'archived_manual'
  );
}

/** Buckets ≤Nh restantes (ceil de la UI). null = sin filtro. */
export function parseInboxWindowMaxFilter(raw?: string): InboxWindowMaxFilter {
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

/** YYYY-MM-DD válido o null. */
export function parseInboxDateParam(raw?: string): string | null {
  const value = String(raw ?? '').trim();
  if (!isYmdDate(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

/** Días inclusivos de actividad reciente cuando la bandeja no trae fechas. */
export const INBOX_DEFAULT_ACTIVITY_DAYS = 15;

export type InboxDateRangeMode = 'default' | 'all' | 'custom';

export function defaultInboxActivityFromYmd(): string {
  return addDaysYmd(
    todayYmdInDisplayTz(),
    -(INBOX_DEFAULT_ACTIVITY_DAYS - 1),
  );
}

/**
 * Sin fechas ni `range=all` ni búsqueda: últimos 15 días, más no leídos antiguos.
 * Con búsqueda y sin fechas, no recorta. `range=all` pide el historial completo.
 */
export function resolveInboxDateFilter(input: {
  searchQ: string;
  from: string | null;
  to: string | null;
  rangeAll: boolean;
}): {
  range: InboxDateRangeMode;
  appliedFrom: string | null;
  appliedTo: string | null;
  includeUnreadOutside: boolean;
} {
  if (input.from || input.to) {
    return {
      range: 'custom',
      appliedFrom: input.from,
      appliedTo: input.to,
      includeUnreadOutside: false,
    };
  }
  if (input.rangeAll || input.searchQ) {
    return {
      range: input.rangeAll ? 'all' : 'default',
      appliedFrom: null,
      appliedTo: null,
      includeUnreadOutside: false,
    };
  }
  return {
    range: 'default',
    appliedFrom: defaultInboxActivityFromYmd(),
    appliedTo: null,
    includeUnreadOutside: true,
  };
}

/**
 * Filtra por día calendario de `last_message_at` en DISPLAY_TIMEZONE.
 * Rango inclusivo; extremos opcionales. Con `includeUnreadOutside`, un no leído
 * antiguo sigue en la lista.
 */
export function buildLastMessageDateRangeSql(
  fromYmd: string | null,
  toYmd: string | null,
  includeUnreadOutside = false,
): Prisma.Sql {
  if (!fromYmd && !toYmd) return Prisma.empty;
  const tz = getReportDisplayTimeZone();
  const parts: Prisma.Sql[] = [Prisma.sql`c.last_message_at IS NOT NULL`];
  if (fromYmd) {
    parts.push(
      Prisma.sql`c.last_message_at >= (${fromYmd}::date::timestamp AT TIME ZONE ${tz})`,
    );
  }
  if (toYmd) {
    parts.push(
      Prisma.sql`c.last_message_at < ((${toYmd}::date + 1)::timestamp AT TIME ZONE ${tz})`,
    );
  }
  const windowSql = Prisma.join(parts, ' AND ');
  if (!includeUnreadOutside) {
    return Prisma.sql` AND ${windowSql}`;
  }
  return Prisma.sql` AND ((${windowSql}) OR c.inbox_unread = TRUE)`;
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
