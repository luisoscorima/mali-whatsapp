import * as XLSX from 'xlsx';
import { Prisma } from '@prisma/client';
import { formatExportDate, exportFilenameDateStamp } from '../campaigns/campaign-format.util';
import { formatAdvisorLabel } from '../users/advisor-label.util';
import { auditCreatedDateSql } from './audit-log-query.util';
import { resolveReportDateRange } from './report-date-range.util';

const EVENT_TYPES = [
  'conversation.assign',
  'conversation.mark_unread',
  'conversation.open',
] as const;

export const CONVERSATION_HISTORY_HEADERS = [
  'Fecha',
  'Número',
  'Nombre',
  'Apellido',
  'DNI',
  'Email',
  'Segmentos actuales',
  'Origen',
  'Tipo',
  'Mensaje',
  'De usuario',
  'A usuario',
  'Actor',
  'Detalle',
] as const;

export type ConversationHistoryRow = {
  id: string;
  created_at: string;
  created_display: string;
  phone: string;
  name: string;
  last_name: string;
  dni: string;
  email: string;
  segments: string;
  origins: string;
  event_type: string;
  message: string;
  from_user: string;
  to_user: string;
  actor_email: string;
  detail: string;
};

function readMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return meta as Record<string, unknown>;
}

function eventLabel(eventType: string): string {
  if (eventType === 'conversation.assign') return 'Reasignación';
  if (eventType === 'conversation.mark_unread') return 'Marcar no leído';
  if (eventType === 'conversation.open') return 'Apertura (lectura)';
  return eventType;
}

type ContactEnrich = {
  phone: string;
  name: string;
  last_name: string;
  dni: string;
  email: string;
  segments: string;
  origins: string;
};

export async function fetchConversationHistoryReport(
  prisma: {
    $queryRawUnsafe: <T>(query: string, ...params: unknown[]) => Promise<T>;
    $queryRaw: <T>(query: Prisma.Sql) => Promise<T>;
    users: {
      findMany: (args: unknown) => Promise<{ id: number; email: string }[]>;
    };
  },
  area: string,
  query: Record<string, string | undefined>,
  opts: { limit: number; offset?: number },
): Promise<{
  total: number;
  rows: ConversationHistoryRow[];
  from: string;
  to: string;
}> {
  const { from, to } = resolveReportDateRange(query.from, query.to);
  const dateExpr = auditCreatedDateSql();
  const whereSql = `WHERE area = $1
    AND event_type = ANY($2::text[])
    AND ${dateExpr} >= $3::date
    AND ${dateExpr} <= $4::date`;
  const params: unknown[] = [area, [...EVENT_TYPES], from, to];

  const countRows = await prisma.$queryRawUnsafe<{ c: number }[]>(
    `SELECT COUNT(*)::int AS c FROM audit_logs ${whereSql}`,
    ...params,
  );
  const total = Number(countRows[0]?.c || 0);

  const listParams = [...params, opts.limit, opts.offset ?? 0];
  const rows = await prisma.$queryRawUnsafe<
    {
      id: bigint | number;
      created_at: Date;
      event_type: string;
      message: string;
      actor_email: string | null;
      meta: unknown;
    }[]
  >(
    `SELECT id, created_at, event_type, message, actor_email, meta
     FROM audit_logs ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $5 OFFSET $6`,
    ...listParams,
  );

  const conversationIds = new Set<number>();
  const userIds = new Set<number>();
  for (const row of rows) {
    const meta = readMeta(row.meta);
    const cid = Number(meta.conversation_id);
    if (Number.isFinite(cid) && cid > 0) conversationIds.add(cid);
    const fromId = Number(meta.from_user_id);
    const toId = Number(meta.to_user_id);
    if (Number.isFinite(fromId) && fromId > 0) userIds.add(fromId);
    if (Number.isFinite(toId) && toId > 0) userIds.add(toId);
  }

  const enrichByConv = new Map<number, ContactEnrich>();
  if (conversationIds.size > 0) {
    const ids = [...conversationIds];
    const enrichRows = await prisma.$queryRaw<
      {
        conversation_id: number;
        phone: string;
        name: string;
        last_name: string;
        dni: string;
        email: string;
        segments: string;
        origins: string;
      }[]
    >(Prisma.sql`
      SELECT
        conv.id AS conversation_id,
        conv.phone,
        COALESCE(c.name, '') AS name,
        COALESCE(c.last_name, '') AS last_name,
        COALESCE(c.dni, '') AS dni,
        COALESCE(c.email, '') AS email,
        COALESCE((
          SELECT string_agg(sd.label, ', ' ORDER BY sd.sort_order NULLS LAST, sd.label)
          FROM contact_segments cs
          JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
          WHERE cs.contact_id = c.id AND cs.area = c.area
        ), '') AS segments,
        COALESCE((
          SELECT string_agg(
            DISTINCT COALESCE(NULLIF(TRIM(co.source_label), ''), co.channel),
            ', '
          )
          FROM contact_origins co
          WHERE co.contact_id = c.id AND co.area = c.area
        ), '') AS origins
      FROM conversations conv
      LEFT JOIN contacts c ON c.id = conv.contact_id
        OR (c.area = conv.area AND c.phone = conv.phone
            AND c.replacement_reason IS NULL AND c.replaced_by_contact_id IS NULL)
      WHERE conv.id = ANY(${ids}::int[])
    `);
    for (const er of enrichRows) {
      enrichByConv.set(Number(er.conversation_id), {
        phone: er.phone || '',
        name: er.name || '',
        last_name: er.last_name || '',
        dni: er.dni || '',
        email: er.email || '',
        segments: er.segments || '',
        origins: er.origins || '',
      });
    }
  }

  const userLabelById = new Map<number, string>();
  if (userIds.size > 0) {
    const users = await prisma.users.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, email: true },
    });
    for (const u of users) {
      userLabelById.set(
        u.id,
        formatAdvisorLabel({
          email: u.email,
          first_name: null,
          last_name: null,
        }),
      );
    }
  }

  return {
    total,
    from,
    to,
    rows: rows.map((row) => {
      const meta = readMeta(row.meta);
      const conversationId = Number(meta.conversation_id);
      const enrich =
        Number.isFinite(conversationId) && conversationId > 0
          ? enrichByConv.get(conversationId)
          : undefined;
      const phone =
        String(meta.phone ?? '').trim() || enrich?.phone || '';

      const fromId = Number(meta.from_user_id);
      const toId = Number(meta.to_user_id);
      const fromUser =
        String(meta.from_user_label ?? '').trim() ||
        (Number.isFinite(fromId) && fromId > 0
          ? userLabelById.get(fromId) || ''
          : '');
      const toUser =
        String(meta.to_user_label ?? '').trim() ||
        (Number.isFinite(toId) && toId > 0
          ? userLabelById.get(toId) || ''
          : '');

      let detail = '';
      try {
        detail = JSON.stringify(meta);
        if (detail.length > 200) detail = `${detail.slice(0, 197)}…`;
      } catch {
        detail = '';
      }

      return {
        id: String(row.id),
        created_at: new Date(row.created_at).toISOString(),
        created_display: formatExportDate(row.created_at) || '—',
        phone,
        name: enrich?.name || '',
        last_name: enrich?.last_name || '',
        dni: enrich?.dni || '',
        email: enrich?.email || '',
        segments: enrich?.segments || '',
        origins: enrich?.origins || '',
        event_type: eventLabel(row.event_type),
        message: row.message,
        from_user: fromUser,
        to_user: toUser,
        actor_email: String(row.actor_email ?? '').trim(),
        detail,
      };
    }),
  };
}

export function buildConversationHistoryXlsxBuffer(
  rows: ConversationHistoryRow[],
): Buffer {
  const aoa: string[][] = [
    [...CONVERSATION_HISTORY_HEADERS],
    ...rows.map((r) => [
      r.created_display,
      r.phone,
      r.name,
      r.last_name,
      r.dni,
      r.email,
      r.segments,
      r.origins,
      r.event_type,
      r.message,
      r.from_user,
      r.to_user,
      r.actor_email,
      r.detail,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hist. chat');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function conversationHistoryExportFilename(area: string): string {
  const part = String(area || 'area')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 40);
  return `hist-chat-${part}-${exportFilenameDateStamp()}.xlsx`;
}
