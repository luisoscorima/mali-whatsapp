const { parse: parseCsv } = require('csv-parse/sync');
const XLSX = require('xlsx');
const config = require('../config');
const { normalizePhone } = require('./phone');

const DEFAULT_PE_PREFIX = '51';
/** Móvil Perú sin código de país (9 dígitos, empieza por 9). */
const PERU_LOCAL_MOBILE = /^9[0-9]{8}$/;

function isValidMaliEmail(email) {
  return config.MALI_EMAIL_REGEX.test(String(email || '').trim());
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

function validateContactCore(name, phone, segment, segmentSet) {
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

/**
 * Formulario: prefijo + número local (Perú por defecto) o un solo campo legacy `phone`.
 */
function validateContactInput(body, segmentSet) {
  const hasLocal = body.phone_local !== undefined && String(body.phone_local).trim() !== '';
  if (hasLocal) {
    const prefix = normalizeDigits(body.phone_prefix) || DEFAULT_PE_PREFIX;
    const local = normalizeDigits(body.phone_local);
    let full = prefix + local;
    if (prefix === DEFAULT_PE_PREFIX) {
      if (!PERU_LOCAL_MOBILE.test(local)) {
        return {
          ok: false,
          message: 'Numero movil Peru: 9 digitos empezando por 9 (sin codigo de pais en el campo numero)',
        };
      }
    } else if (!config.e164NoPlusRegex.test(full)) {
      return { ok: false, message: 'Telefono invalido para el prefijo indicado' };
    }
    return validateContactCore(body.name, full, body.segment, segmentSet);
  }

  return validateContactCore(body.name, body.phone, body.segment, segmentSet);
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
  const phone = r.phone ?? r.telefono ?? r.tel ?? r['teléfono'] ?? r.telefono_movil ?? r.movil;
  const segment = r.segment ?? r.segmento;
  const prefix = r.prefix ?? r.prefijo ?? r.country_code ?? r.country ?? r.pais;
  return { name, phone, segment, prefix };
}

/**
 * Importación CSV/Excel: sin columna `prefix`, solo números móviles Perú de 9 dígitos o E.164 completo.
 * Con `prefix` no vacío: se concatena prefijo + dígitos del teléfono (nacional o sin +).
 */
function normalizeImportRecord(picked, segmentSet) {
  const name = picked.name;
  const segment = picked.segment;
  const prefixRaw = picked.prefix;
  const hasPrefixCol = prefixRaw !== undefined && prefixRaw !== null && String(prefixRaw).trim() !== '';
  const prefixDigits = hasPrefixCol ? normalizeDigits(prefixRaw) : '';
  const phoneDigits = normalizeDigits(picked.phone);

  let fullPhone = '';
  if (prefixDigits.length > 0) {
    fullPhone = prefixDigits + phoneDigits;
  } else if (phoneDigits.length === 9 && PERU_LOCAL_MOBILE.test(phoneDigits)) {
    fullPhone = DEFAULT_PE_PREFIX + phoneDigits;
  } else if (config.e164NoPlusRegex.test(phoneDigits)) {
    fullPhone = phoneDigits;
  } else {
    return {
      ok: false,
      message:
        'Telefono: use 9 digitos movil PE (982160981), E.164 sin +, o columna prefix para internacional',
    };
  }

  return validateContactCore(name, fullPhone, segment, segmentSet);
}

function dedupeRowsByPhone(rows) {
  const byPhone = new Map();
  for (const row of rows) {
    byPhone.set(row.phone, row);
  }
  return [...byPhone.values()];
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
    const v = normalizeImportRecord(picked, segmentSet);
    if (!v.ok) {
      errors.push({ line: i + 2, message: v.message });
      continue;
    }
    rows.push(v.value);
  }
  return { rows: dedupeRowsByPhone(rows), errors };
}

function parseContactXlsxBuffer(buffer, segmentSet) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const name = wb.SheetNames[0];
  if (!name) {
    return { rows: [], errors: [{ line: 1, message: 'Excel sin hojas' }] };
  }
  const sheet = wb.Sheets[name];
  const records = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const rows = [];
  const errors = [];
  for (let i = 0; i < records.length; i++) {
    const picked = pickContactFieldsFromRecord(records[i]);
    const v = normalizeImportRecord(picked, segmentSet);
    if (!v.ok) {
      errors.push({ line: i + 2, message: v.message });
      continue;
    }
    rows.push(v.value);
  }
  return { rows: dedupeRowsByPhone(rows), errors };
}

module.exports = {
  isValidMaliEmail,
  normalizeEmail,
  validateContactInput,
  validateContactCore,
  parseContactCsvBuffer,
  parseContactXlsxBuffer,
  pickContactFieldsFromRecord,
  normalizeImportRecord,
};
