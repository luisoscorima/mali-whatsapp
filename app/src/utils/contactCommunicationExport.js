const XLSX = require('xlsx');
const { exportFilenameDateStamp } = require('./datetimeDisplay');
const { safeFilenamePart } = require('./conversationExport');
const { REPORT_HEADERS, reportRowToExportCells } = require('../services/contactCommunicationReport');

function buildContactCommunicationXlsxBuffer(rows) {
  const aoa = [REPORT_HEADERS, ...rows.map((r) => reportRowToExportCells(r))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 16 },
    { wch: 28 },
    { wch: 22 },
    { wch: 12 },
    { wch: 48 },
    { wch: 48 },
    { wch: 22 },
    { wch: 18 },
    { wch: 48 },
    { wch: 48 },
    { wch: 14 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Comunicaciones');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function contactCommunicationExportFilename(area) {
  const stamp = exportFilenameDateStamp();
  return `comunicaciones-${safeFilenamePart(area)}-${stamp}.xlsx`;
}

module.exports = {
  buildContactCommunicationXlsxBuffer,
  contactCommunicationExportFilename,
};
