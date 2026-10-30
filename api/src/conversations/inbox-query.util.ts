import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { segmentDefinitionCategorySql } from '../config/category-scope';
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

/** Id de línea WhatsApp. null = sin filtro. */
export function parseInboxLineFilter(raw?: string): number | null {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
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

export function buildLineFilterSql(lineId: number | null): Prisma.Sql {
  if (lineId == null) return Prisma.empty;
  return Prisma.sql` AND c.whatsapp_line_id = ${lineId}`;
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

/** Ventana por defecto al buscar (sin `range=all` ni from/to). */
export const INBOX_SEARCH_ACTIVITY_DAYS = 30;

/** Mín. caracteres para buscar en cuerpo de mensajes (texto). */
export const INBOX_SEARCH_MESSAGES_MIN_CHARS = 4;

/** Mín. dígitos para buscar en cuerpo cuando el término es solo teléfono. */
export const INBOX_SEARCH_MESSAGES_MIN_DIGITS = 3;

export type InboxDateRangeMode = 'default' | 'all' | 'custom';

export function defaultInboxActivityFromYmd(): string {
  return addDaysYmd(todayYmdInDisplayTz(), -(INBOX_DEFAULT_ACTIVITY_DAYS - 1));
}

export function defaultInboxSearchFromYmd(): string {
  return addDaysYmd(todayYmdInDisplayTz(), -(INBOX_SEARCH_ACTIVITY_DAYS - 1));
}

/** ¿El término alcanza para pegarle a chat_messages? */
export function inboxSearchMayScanMessages(
  searchQ: string,
  includeMessagesFlag: boolean,
): boolean {
  if (!includeMessagesFlag) return false;
  const trimmed = String(searchQ ?? '').trim();
  if (!trimmed) return false;
  const digitsOnly = trimmed.replace(/\D/g, '');
  const compact = trimmed.replace(/[\s\-()+]/g, '');
  const isPhoneQuery = digitsOnly.length > 0 && compact === digitsOnly;
  if (isPhoneQuery) return digitsOnly.length >= INBOX_SEARCH_MESSAGES_MIN_DIGITS;
  return trimmed.length >= INBOX_SEARCH_MESSAGES_MIN_CHARS;
}

/**
 * Sin fechas ni `range=all`: últimos 15 días (+ no leídos antiguos).
 * Con búsqueda y sin fechas/`range=all`: últimos 30 días.
 * `range=all` pide el historial completo (también con búsqueda).
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
  if (input.rangeAll) {
    return {
      range: 'all',
      appliedFrom: null,
      appliedTo: null,
      includeUnreadOutside: false,
    };
  }
  if (input.searchQ) {
    return {
      range: 'default',
      appliedFrom: defaultInboxSearchFromYmd(),
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

export type InboxSegmentFilter = SegmentListFilter & {
  ids?: number[];
  categories?: string[] | null;
};

export function parseInboxSegmentFilter(
  raw: string[],
  options: Array<{ id: number; slug: string }>,
  categories: string[] | null,
): InboxSegmentFilter {
  const ids: number[] = [];
  const slugs: string[] = [];
  let includeNone = false;
  for (const token of new Set(raw)) {
    if (token === '__none__') {
      includeNone = true;
      continue;
    }
    if (/^id:[1-9][0-9]*$/.test(token)) {
      const id = Number(token.slice(3));
      if (
        !Number.isSafeInteger(id) ||
        !options.some((option) => option.id === id)
      )
        throw new BadRequestException(
          'El segmento no pertenece al área o categorías seleccionadas',
        );
      ids.push(id);
    } else if (options.some((option) => option.slug === token))
      slugs.push(token);
    else
      throw new BadRequestException('Segmento desconocido para esta selección');
  }
  return { ids, slugs, includeNone, categories };
}

function segmentMembershipSql(
  filter: InboxSegmentFilter,
  conversation: boolean,
  selected: boolean,
): Prisma.Sql {
  const selection = selected
    ? Prisma.sql`AND (sd.id = ANY(${filter.ids ?? []}::int[]) OR sd.slug = ANY(${filter.slugs}::varchar[]))`
    : Prisma.empty;
  const line = conversation
    ? Prisma.sql`AND EXISTS (
    SELECT 1 FROM conversations seg_conv
    LEFT JOIN whatsapp_lines seg_line ON seg_line.id = seg_conv.whatsapp_line_id
    WHERE seg_conv.id = c.id AND (
      (seg_line.program_id IS NOT NULL AND sd.program_id = seg_line.program_id)
      OR (seg_line.program_id IS NULL AND NULLIF(BTRIM(seg_line.program_key), '') IS NOT NULL
        AND EXISTS (SELECT 1 FROM business_programs bp WHERE bp.id = sd.program_id AND bp.slug = BTRIM(seg_line.program_key)))
      OR ((seg_line.id IS NULL OR (seg_line.program_id IS NULL AND COALESCE(BTRIM(seg_line.program_key), '') = '')) AND sd.program_id IS NULL)
    )
  )`
    : Prisma.empty;
  return Prisma.sql`EXISTS (
    SELECT 1 FROM contact_segments csf
    JOIN segment_definitions sd ON sd.area = csf.area AND sd.slug = csf.segment_slug
      AND sd.program_id IS NOT DISTINCT FROM csf.program_id
    WHERE csf.contact_id = ct.id AND csf.area = ct.area
      AND ${segmentDefinitionCategorySql(filter.categories ?? null)}
      ${selection} ${line}
  )`;
}

function buildSegmentSql(
  filter: InboxSegmentFilter,
  conversation: boolean,
): Prisma.Sql {
  const clauses: Prisma.Sql[] = [];
  if (filter.slugs.length || filter.ids?.length)
    clauses.push(segmentMembershipSql(filter, conversation, true));
  if (filter.includeNone)
    clauses.push(
      Prisma.sql`NOT ${segmentMembershipSql(filter, conversation, false)}`,
    );
  if (!clauses.length) return Prisma.empty;
  return Prisma.sql` AND (${Prisma.join(clauses, ' OR ')})`;
}

export function buildConversationSegmentSql(
  filter: InboxSegmentFilter,
): Prisma.Sql {
  return buildSegmentSql(filter, true);
}
export function buildContactSegmentSql(filter: InboxSegmentFilter): Prisma.Sql {
  return buildSegmentSql(filter, false);
}
