const { parse: parseCsv } = require('csv-parse/sync');
const XLSX = require('xlsx');
const config = require('../config');
const { isValidMaliEmail, normalizeEmail } = require('./contactsCsv');

function normalizeRecordKeys(record) {
  const r = {};
  for (const [k, v] of Object.entries(record)) {
    const key = String(k || '')
      .toLowerCase()
      .trim()
      .replace(/^\uFEFF/, '');
    r[key] = v;
  }
  return r;
}

/** Prioridad: columnas `email` / `correo`; si no, primera celda no vacía de la fila. */
function pickEmailRaw(record) {
  const r = normalizeRecordKeys(record);
  const named = r.email ?? r.correo;
  if (named !== undefined && named !== null && String(named).trim() !== '') {
    return String(named).trim();
  }
  for (const v of Object.values(r)) {
    const s = String(v ?? '').trim();
    if (s) return s;
  }
  return '';
}

function collectEmailsFromRecords(records) {
  if (records.length > config.MAX_CSV_ROWS) {
    return { emails: [], bad: 0, tooMany: true };
  }

  const seen = new Set();
  const emails = [];
  let bad = 0;

  for (const rec of records) {
    const raw = pickEmailRaw(rec);
    if (!raw) continue;
    const email = normalizeEmail(raw);
    if (!isValidMaliEmail(email)) {
      bad += 1;
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    emails.push(email);
  }

  return { emails, bad, tooMany: false };
}

function parseUsersBulkCsvBuffer(buffer) {
  const text = buffer.toString('utf8');
  const records = parseCsv(text, {
    columns: (header) =>
      header.map((h) =>
        String(h || '')
          .toLowerCase()
          .trim()
          .replace(/^\uFEFF/, '')
      ),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  });
  return collectEmailsFromRecords(records);
}

function parseUsersBulkXlsxBuffer(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const name = wb.SheetNames[0];
  if (!name) {
    return { emails: [], bad: 0, tooMany: false, noSheet: true };
  }
  const sheet = wb.Sheets[name];
  const records = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return collectEmailsFromRecords(records);
}

module.exports = {
  parseUsersBulkCsvBuffer,
  parseUsersBulkXlsxBuffer,
};
