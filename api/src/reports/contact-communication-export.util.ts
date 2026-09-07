import * as XLSX from 'xlsx';
import { exportFilenameDateStamp } from '../campaigns/campaign-format.util';
import {
  REPORT_HEADERS,
  reportRowToExportCells,
  type ContactCommunicationRow,
} from './contact-communication-report.util';

function safeFilenamePart(value: string): string {
  return String(value || 'area')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .slice(0, 40);
}

export function buildContactCommunicationXlsxBuffer(
  rows: ContactCommunicationRow[],
): Buffer {
  const aoa: string[][] = [
    [...REPORT_HEADERS],
    ...rows.map((r) => reportRowToExportCells(r)),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = REPORT_HEADERS.map((h) => ({
    wch: Math.min(48, Math.max(12, h.length + 2)),
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Comunicaciones');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function contactCommunicationExportFilename(area: string): string {
  return `comunicaciones-${safeFilenamePart(area)}-${exportFilenameDateStamp()}.xlsx`;
}
