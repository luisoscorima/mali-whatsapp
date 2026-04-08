const { parse: parseCsv } = require('csv-parse/sync');
const config = require('../config');
const { normalizePhone } = require('./phone');

function isValidMaliEmail(email) {
  return config.MALI_EMAIL_REGEX.test(String(email || '').trim());
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function validateContactInput({ name, phone, segment }, segmentSet) {
  const normalizedName = String(name || '').trim();
  const normalizedPhone = normalizePhone(phone);
  const normalizedSegment = String(segment || '').trim();

  if (!normalizedName || normalizedName.length > config.MAX_NAME_LEN) {
    return { ok: false, message: `Nombre invalido (1-${config.MAX_NAME_LEN} caracteres)` };
  }
  if (!config.e164NoPlusRegex.test(normalizedPhone)) {
    return { ok: false, message: 'Telefono invalido. Usa formato E.164 sin +' };
  }
  if (!segmentSet.has(normalizedSegment)) {
    return { ok: false, message: 'Segmento invalido' };
  }

  return {
    ok: true,
    value: {
      name: normalizedName,
      phone: normalizedPhone,
      segment: normalizedSegment,
    },
  };
}

function pickContactFieldsFromRecord(record) {
  const r = {};
  for (const [k, v] of Object.entries(record)) {
    const key = String(k || '')
      .toLowerCase()
      .trim()
      .replace(/^\uFEFF/, '');
    r[key] = v;
  }
  const name = r.name ?? r.nombre ?? r['nombre completo'];
  const phone = r.phone ?? r.telefono ?? r.tel ?? r['teléfono'] ?? r.telefono_movil;
  const segment = r.segment ?? r.segmento;
  return { name, phone, segment };
}

function parseContactCsvBuffer(buffer, segmentSet) {
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
  const rows = [];
  const errors = [];
  for (let i = 0; i < records.length; i++) {
    const picked = pickContactFieldsFromRecord(records[i]);
    const v = validateContactInput(picked, segmentSet);
    if (!v.ok) {
      errors.push({ line: i + 2, message: v.message });
      continue;
    }
    rows.push(v.value);
  }
  const byPhone = new Map();
  for (const row of rows) {
    byPhone.set(row.phone, row);
  }
  return { rows: [...byPhone.values()], errors };
}

module.exports = {
  isValidMaliEmail,
  normalizeEmail,
  validateContactInput,
  parseContactCsvBuffer,
};
