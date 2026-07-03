import * as XLSX from 'xlsx';
import { collectLatestLogsByPhone } from './campaign-analytics.util';
import { formatExportDate } from './campaign-format.util';
import type { EnrichedFailedLog } from './campaign-incident.util';

export type CampaignExportLogRow = {
  id: number;
  phone: string;
  status: string;
  response: unknown;
  created_at: Date | string;
  whatsapp_message_id?: string | null;
  contact_name?: string;
  segment_labels?: string;
};

function exportContactName(log: { contact_name?: string }): string {
  return String(log.contact_name || '').trim();
}

function exportSegmentLabels(log: { segment_labels?: string }): string {
  return String(log.segment_labels || '').trim();
}

function stringifyExportDetail(response: unknown): string {
  if (response == null || response === '') return '';
  if (typeof response === 'string') return response;
  try {
    return JSON.stringify(response);
  } catch {
    return String(response);
  }
}

function normalizeCampaignLogStatus(status: unknown): string {
  return String(status || '')
    .trim()
    .toLowerCase();
}

export function filterCampaignCurrentLogs(
  logs: CampaignExportLogRow[],
  filter: string,
): CampaignExportLogRow[] {
  const latestLogs = collectLatestLogsByPhone(logs);
  const key = String(filter || 'all_current')
    .trim()
    .toLowerCase();
  if (!key || key === 'all_current') return latestLogs;
  return latestLogs.filter((log) => {
    const status = normalizeCampaignLogStatus(log.status);
    if (key === 'sent_all') {
      return status === 'sent' || status === 'delivered' || status === 'read';
    }
    if (key === 'delivered_all') {
      return status === 'delivered' || status === 'read';
    }
    if (key === 'read_only') return status === 'read';
    if (key === 'sent_only') return status === 'sent';
    if (key === 'delivered_only') return status === 'delivered';
    return true;
  });
}

export function filterCampaignFailedLogs(
  logs: EnrichedFailedLog[],
  filter: string,
): EnrichedFailedLog[] {
  const key = String(filter || 'all')
    .trim()
    .toLowerCase();
  if (!key || key === 'all') return logs;
  return logs.filter(
    (log) => String(log.incident_type || '').trim().toLowerCase() === key,
  );
}

function csvEscapeCell(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildCampaignFailedLogsCsv(
  logs: EnrichedFailedLog[],
  formatDate: (value: Date | string) => string = formatExportDate,
): string {
  const header = [
    'telefono',
    'nombre',
    'segmentos',
    'estado',
    'incidencia',
    'motivo',
    'fecha_envio',
  ];
  const lines = [header.join(',')];
  for (const log of logs) {
    lines.push(
      [
        csvEscapeCell(log.phone),
        csvEscapeCell(exportContactName(log)),
        csvEscapeCell(exportSegmentLabels(log)),
        csvEscapeCell(log.status),
        csvEscapeCell(log.incident_label || ''),
        csvEscapeCell(log.error_summary || ''),
        csvEscapeCell(formatDate(log.created_at)),
      ].join(','),
    );
  }
  return `${lines.join('\n')}\n`;
}

export function buildCampaignLogsExportBuffer(
  logs: CampaignExportLogRow[],
  formatDate: (value: Date | string) => string = formatExportDate,
): Buffer {
  const aoa = [
    [
      'Fecha y hora',
      'Teléfono',
      'Nombre',
      'Segmentos',
      'Estado',
      'ID mensaje',
      'Detalle',
    ],
    ...logs.map((log) => [
      formatDate(log.created_at),
      String(log.phone || ''),
      exportContactName(log),
      exportSegmentLabels(log),
      String(log.status || ''),
      String(log.whatsapp_message_id || ''),
      stringifyExportDetail(log.response),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 24 },
    { wch: 18 },
    { wch: 28 },
    { wch: 36 },
    { wch: 14 },
    { wch: 28 },
    { wch: 90 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Registro de envíos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function buildCampaignFailedLogsExportBuffer(
  logs: EnrichedFailedLog[],
  formatDate: (value: Date | string) => string = formatExportDate,
): Buffer {
  const aoa = [
    [
      'Fecha y hora',
      'Teléfono',
      'Nombre',
      'Segmentos',
      'Estado',
      'Incidencia',
      'Motivo',
    ],
    ...logs.map((log) => [
      formatDate(log.created_at),
      String(log.phone || ''),
      exportContactName(log),
      exportSegmentLabels(log),
      String(log.status || ''),
      String(log.incident_label || ''),
      String(log.error_summary || ''),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 24 },
    { wch: 18 },
    { wch: 28 },
    { wch: 36 },
    { wch: 14 },
    { wch: 24 },
    { wch: 80 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Incidencias');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export type ResponderExportRow = {
  phone: string;
  contact_name?: string;
  segment_labels?: string;
  first_response_at: Date | string;
  interactive_response_text?: string;
};

export function buildCampaignRespondersExportBuffer(
  rows: ResponderExportRow[],
  formatDate: (value: Date | string) => string = formatExportDate,
): Buffer {
  const aoa = [
    [
      'Teléfono',
      'Nombre',
      'Segmentos',
      'Primera respuesta',
      'Respuesta interactiva',
    ],
    ...rows.map((row) => [
      String(row.phone || ''),
      String(row.contact_name || ''),
      String(row.segment_labels || ''),
      formatDate(row.first_response_at),
      String(row.interactive_response_text || ''),
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 18 },
    { wch: 28 },
    { wch: 36 },
    { wch: 24 },
    { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Respuestas');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
