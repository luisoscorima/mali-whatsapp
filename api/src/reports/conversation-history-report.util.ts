import * as XLSX from 'xlsx';
import { formatExportDate, exportFilenameDateStamp } from '../campaigns/campaign-format.util';
import { auditCreatedDateSql } from './audit-log-query.util';
import { resolveReportDateRange } from './report-date-range.util';

const EVENT_TYPES = [
  'conversation.assign',
  'conversation.mark_unread',
  'conversation.open',
] as const;

export const CONVERSATION_HISTORY_HEADERS = [
  'Fecha',
  'Tipo',
  'Mensaje',
  'Teléfono',
  'Conversación ID',
  'De usuario',
  'A usuario',
  'Actor',
  'Detalle',
] as const;

export type ConversationHistoryRow = {
  id: string;
  created_at: string;
  created_display: string;
  event_type: string;
  message: string;
  phone: string;
  conversation_id: number | null;
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

export async function fetchConversationHistoryReport(
  prisma: {
    $queryRawUnsafe: <T>(query: string, ...params: unknown[]) => Promise<T>;
    conversations: {
      findMany: (args: unknown) => Promise<{ id: number; phone: string }[]>;
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
  for (const row of rows) {
    const cid = Number(readMeta(row.meta).conversation_id);
    if (Number.isFinite(cid) && cid > 0) conversationIds.add(cid);
  }
  const conversations =
    conversationIds.size > 0
      ? await prisma.conversations.findMany({
          where: { id: { in: [...conversationIds] } },
          select: { id: true, phone: true },
        })
      : [];
  const phoneByConv = new Map(conversations.map((c) => [c.id, c.phone]));

  return {
    total,
    from,
    to,
    rows: rows.map((row) => {
      const meta = readMeta(row.meta);
      const conversationId = Number(meta.conversation_id);
      const phone =
        String(meta.phone ?? '').trim() ||
        (Number.isFinite(conversationId)
          ? phoneByConv.get(conversationId) || ''
          : '');
      const fromUser =
        String(meta.from_user_id ?? '').trim() ||
        String(meta.from_user_label ?? '').trim();
      const toUser =
        String(meta.to_user_label ?? '').trim() ||
        String(meta.to_user_id ?? '').trim();
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
        event_type: eventLabel(row.event_type),
        message: row.message,
        phone,
        conversation_id:
          Number.isFinite(conversationId) && conversationId > 0
            ? conversationId
            : null,
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
      r.event_type,
      r.message,
      r.phone,
      r.conversation_id != null ? String(r.conversation_id) : '',
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
