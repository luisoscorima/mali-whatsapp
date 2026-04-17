const XLSX = require('xlsx');

const TYPE_LABEL = {
  text: 'Texto',
  image: 'Imagen',
  video: 'Video',
  audio: 'Audio',
  voice: 'Nota de voz',
  document: 'Documento',
  sticker: 'Sticker',
  location: 'Ubicación',
  contacts: 'Contacto',
  button: 'Botón',
  interactive: 'Interactivo',
  unknown: 'Otro',
};

function parseRawPayload(raw) {
  if (raw == null) return null;
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Nombre de archivo asociado al multimedia (Meta inbound o vista previa local).
 */
function extractMediaFileName(rawPayload, messageType) {
  const p = parseRawPayload(rawPayload);
  if (!p) return '';
  if (p.document?.filename) return String(p.document.filename).trim();
  if (p.type === 'document' && p.document?.filename) return String(p.document.filename).trim();
  if (p.local_preview?.url) {
    const tail = String(p.local_preview.url).split('/').pop() || '';
    if (tail && tail.includes('.')) return tail;
  }
  return '';
}

function formatExportDate(isoOrDate) {
  if (!isoOrDate) return '';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'medium' });
}

function labelMessageType(messageType) {
  const t = String(messageType || 'text').trim();
  return TYPE_LABEL[t] || t;
}

function buildExportRows(messages) {
  return messages.map((m) => {
    const remitente = m.direction === 'inbound' ? 'Cliente' : 'Equipo';
    const mediaName = extractMediaFileName(m.raw_payload, m.message_type);
    return {
      fecha: formatExportDate(m.created_at),
      remitente,
      tipo: labelMessageType(m.message_type),
      texto: String(m.body_text ?? '').trim(),
      nombreMultimedia: mediaName,
    };
  });
}

function escapeCsvCell(val) {
  const s = String(val ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildCsvBuffer(rows) {
  const header = ['Fecha y hora', 'Remitente', 'Tipo', 'Texto', 'Nombre multimedia'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        escapeCsvCell(r.fecha),
        escapeCsvCell(r.remitente),
        escapeCsvCell(r.tipo),
        escapeCsvCell(r.texto),
        escapeCsvCell(r.nombreMultimedia),
      ].join(',')
    );
  }
  const body = lines.join('\r\n');
  return Buffer.from(`\ufeff${body}`, 'utf8');
}

function buildXlsxBuffer(rows) {
  const aoa = [
    ['Fecha y hora', 'Remitente', 'Tipo', 'Texto', 'Nombre multimedia'],
    ...rows.map((r) => [r.fecha, r.remitente, r.tipo, r.texto, r.nombreMultimedia]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 22 }, { wch: 10 }, { wch: 14 }, { wch: 60 }, { wch: 36 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Conversación');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function safeFilenamePart(s) {
  return String(s || '')
    .replace(/[^\w.\-+]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 80);
}

module.exports = {
  buildExportRows,
  buildCsvBuffer,
  buildXlsxBuffer,
  safeFilenamePart,
};
