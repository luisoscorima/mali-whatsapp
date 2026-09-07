import { formatExportDate } from '../campaigns/campaign-format.util';
import { exportFilenameDateStamp } from '../campaigns/campaign-format.util';
import * as XLSX from 'xlsx';
import { auditCreatedDateSql } from './audit-log-query.util';
import { resolveReportDateRange } from './report-date-range.util';

export const SEGMENT_HISTORY_HEADERS = [
  'Fecha',
  'Contacto ID',
  'Teléfono',
  'Nombre',
  'Agregados',
  'Quitados',
  'Segmentos resultantes',
  'Actor',
] as const;

export type SegmentHistoryRow = {
  id: string;
  created_at: string;
  created_display: string;
  contact_id: number | null;
  phone: string;
  name: string;
  added: string;
  removed: string;
  segments: string;
  actor_email: string;
};

function readMeta(meta: unknown): Record<string, unknown> {
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return meta as Record<string, unknown>;
}

function listField(meta: Record<string, unknown>, key: string): string {
  const v = meta[key];
  if (Array.isArray(v)) return v.map((x) => String(x)).filter(Boolean).join(', ');
  return String(v ?? '').trim();
}

export async function fetchSegmentHistoryReport(
  prisma: {
    $queryRawUnsafe: <T>(query: string, ...params: unknown[]) => Promise<T>;
    contacts: {
      findMany: (args: unknown) => Promise<
        { id: number; phone: string | null; name: string; last_name: string }[]
      >;
    };
  },
  area: string,
  query: Record<string, string | undefined>,
  opts: { limit: number; offset?: number },
): Promise<{ total: number; rows: SegmentHistoryRow[]; from: string; to: string }> {
  const { from, to } = resolveReportDateRange(query.from, query.to);
  const dateExpr = auditCreatedDateSql();
  const whereSql = `WHERE area = $1
    AND event_type = $2
    AND ${dateExpr} >= $3::date
    AND ${dateExpr} <= $4::date`;
  const params: unknown[] = [area, 'contact.segment_change', from, to];

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
      actor_email: string | null;
      meta: unknown;
    }[]
  >(
    `SELECT id, created_at, actor_email, meta
     FROM audit_logs ${whereSql}
     ORDER BY created_at DESC, id DESC
     LIMIT $5 OFFSET $6`,
    ...listParams,
  );

  const contactIds = new Set<number>();
  for (const row of rows) {
    const cid = Number(readMeta(row.meta).contact_id);
    if (Number.isFinite(cid) && cid > 0) contactIds.add(cid);
  }
  const contacts =
    contactIds.size > 0
      ? await prisma.contacts.findMany({
          where: { id: { in: [...contactIds] } },
          select: { id: true, phone: true, name: true, last_name: true },
        })
      : [];
  const byId = new Map(contacts.map((c) => [c.id, c]));

  return {
    total,
    from,
    to,
    rows: rows.map((row) => {
      const meta = readMeta(row.meta);
      const contactId = Number(meta.contact_id);
      const contact =
        Number.isFinite(contactId) && contactId > 0 ? byId.get(contactId) : undefined;
      const phone =
        String(meta.phone ?? '').trim() || contact?.phone || '';
      const name = contact
        ? [contact.name, contact.last_name].filter(Boolean).join(' ').trim()
        : '';
      return {
        id: String(row.id),
        created_at: new Date(row.created_at).toISOString(),
        created_display: formatExportDate(row.created_at) || '—',
        contact_id: Number.isFinite(contactId) && contactId > 0 ? contactId : null,
        phone,
        name,
        added: listField(meta, 'added'),
        removed: listField(meta, 'removed'),
        segments: listField(meta, 'segments'),
        actor_email: String(row.actor_email ?? '').trim(),
      };
    }),
  };
}

export function buildSegmentHistoryXlsxBuffer(rows: SegmentHistoryRow[]): Buffer {
  const aoa: string[][] = [
    [...SEGMENT_HISTORY_HEADERS],
    ...rows.map((r) => [
      r.created_display,
      r.contact_id != null ? String(r.contact_id) : '',
      r.phone,
      r.name,
      r.added,
      r.removed,
      r.segments,
      r.actor_email,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Hist. segmentos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function segmentHistoryExportFilename(area: string): string {
  const part = String(area || 'area')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 40);
  return `hist-segmentos-${part}-${exportFilenameDateStamp()}.xlsx`;
}
