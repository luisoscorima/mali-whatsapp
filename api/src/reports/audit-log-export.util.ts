import * as XLSX from 'xlsx';
import {
  exportFilenameDateStamp,
  formatExportDate,
} from '../campaigns/campaign-format.util';
import { summarizeMetaForAuditRow } from './audit-log-query.util';

const AUDIT_LOG_EXPORT_HEADERS = [
  'Fecha y hora',
  'Nivel',
  'Tipo',
  'Mensaje',
  'Teléfono',
  'Actor ID',
  'Actor email',
  'Área',
  'IP',
  'Request ID',
  'Detalle',
];

export type AuditLogExportRow = {
  created_at: Date | string;
  level: string;
  event_type: string;
  message: string;
  phone?: string | null;
  actor_user_id: number | null;
  actor_email: string | null;
  area: string | null;
  client_ip: string | null;
  request_id: string | null;
  meta: unknown;
};

export function buildAuditLogXlsxBuffer(rows: AuditLogExportRow[]): Buffer {
  const aoa = [
    AUDIT_LOG_EXPORT_HEADERS,
    ...rows.map((row) => [
      formatExportDate(row.created_at) || '',
      row.level,
      row.event_type,
      String(row.message || ''),
      row.phone != null ? String(row.phone) : '',
      row.actor_user_id != null ? row.actor_user_id : '',
      row.actor_email != null ? String(row.actor_email) : '',
      row.area != null ? String(row.area) : '',
      row.client_ip != null ? String(row.client_ip) : '',
      row.request_id != null ? String(row.request_id) : '',
      summarizeMetaForAuditRow(row.meta),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 22 },
    { wch: 8 },
    { wch: 24 },
    { wch: 48 },
    { wch: 16 },
    { wch: 10 },
    { wch: 28 },
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bitácora');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function auditLogExportFilename(prefix = 'bitacora-ajustes'): string {
  return `${prefix}-${exportFilenameDateStamp()}.xlsx`;
}
