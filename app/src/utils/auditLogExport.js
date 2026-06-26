const XLSX = require('xlsx');
const { formatExportDate, exportFilenameDateStamp } = require('./datetimeDisplay');
const { summarizeMetaForAuditRow } = require('./auditLogQuery');

const AUDIT_LOG_EXPORT_HEADERS = [
  'Fecha y hora',
  'Nivel',
  'Tipo',
  'Mensaje',
  'Actor ID',
  'Actor email',
  'Área',
  'IP',
  'Request ID',
  'Detalle',
];

function buildAuditLogXlsxBuffer(rows) {
  const aoa = [
    AUDIT_LOG_EXPORT_HEADERS,
    ...rows.map((row) => [
      formatExportDate(row.created_at) || '',
      row.level,
      row.event_type,
      String(row.message || ''),
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
    { wch: 10 },
    { wch: 28 },
    { wch: 12 },
    { wch: 16 },
    { wch: 14 },
    { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Bitácora');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function auditLogExportFilename(prefix) {
  return `${prefix || 'bitacora-audit'}-${exportFilenameDateStamp()}.xlsx`;
}

module.exports = {
  buildAuditLogXlsxBuffer,
  auditLogExportFilename,
};
