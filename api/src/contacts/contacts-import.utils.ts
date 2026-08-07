import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import {
  E164_NO_PLUS_REGEX,
  MAX_CONTACT_NAME_LEN,
  DEFAULT_PE_PREFIX,
  PERU_LOCAL_MOBILE,
  normalizeDigits,
  normalizePhone,
  validateContactCore,
} from './contacts-validation.utils';

export const MAX_CSV_ROWS = 10_000;
export const MAX_CSV_BYTES = 5 * 1024 * 1024;

const KNOWN_COLUMNS = new Set([
  'name',
  'nombre',
  'nombre completo',
  'last_name',
  'apellido',
  'apellidos',
  'phone',
  'telefono',
  'tel',
  'teléfono',
  'telefono_movil',
  'movil',
  'segment',
  'segmento',
  'prefix',
  'prefijo',
  'country_code',
  'country',
  'pais',
  'email',
  'correo',
  'mail',
  'dni',
  'documento',
]);

export type ImportContactRow = {
  name: string;
  last_name: string;
  phone: string;
  email?: string | null;
  dni?: string | null;
  segments: string[];
  attributes: Record<string, string>;
};

export type ImportParseError = {
  line: number;
  message: string;
};

export type ImportParseResult = {
  rows: ImportContactRow[];
  errors: ImportParseError[];
  duplicate_phones_in_file: number;
  duplicate_rows_in_file: number;
  duplicate_phone_examples: string[];
};

type PickedRecord = {
  name?: string;
  last_name?: string;
  full_name?: string;
  phone?: string;
  segment?: string;
  prefix?: string;
  email?: string;
  dni?: string;
  attributes: Record<string, string>;
};

function normalizeRecordKeys(
  record: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const normalized = String(key ?? '')
      .toLowerCase()
      .trim()
      .replace(/^\uFEFF/, '');
    out[normalized] = String(value ?? '').trim();
  }
  return out;
}

function pickContactFieldsFromRecord(
  record: Record<string, unknown>,
): PickedRecord {
  const r = normalizeRecordKeys(record);
  const name = r.name || r.nombre || undefined;
  const full_name = r['nombre completo'] || undefined;
  const last_name = r.last_name || r.apellido || r.apellidos || undefined;
  const phone =
    r.phone ||
    r.telefono ||
    r.tel ||
    r['teléfono'] ||
    r.telefono_movil ||
    r.movil;
  const segment = r.segment || r.segmento;
  const prefix = r.prefix || r.prefijo || r.country_code || r.country || r.pais;
  const email = r.email || r.correo || r.mail || undefined;
  const dni = r.dni || r.documento || undefined;

  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(r)) {
    if (!KNOWN_COLUMNS.has(key) && value) {
      attributes[key] = value;
    }
  }

  return {
    name,
    last_name,
    full_name,
    phone,
    segment,
    prefix,
    email,
    dni,
    attributes,
  };
}

function parseSegmentListFromImportCell(cell: unknown): string[] {
  const raw = String(cell ?? '').trim();
  if (!raw) return [];
  return [
    ...new Set(
      raw
        .split(/[;,]/)
        .map((part) => part.trim())
        .filter(Boolean),
    ),
  ];
}

function resolveNameForImport(
  picked: PickedRecord,
): { name: string; last_name: string } | { error: string } {
  const explicitName = String(picked.name ?? '').trim();
  const explicitLast = String(picked.last_name ?? '').trim();
  const fullName = String(picked.full_name ?? '').trim();

  if (explicitName && explicitLast) {
    return { name: explicitName, last_name: explicitLast };
  }

  const source = fullName || explicitName;
  if (!source) {
    return { error: 'Nombre inválido' };
  }

  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return { name: parts[0], last_name: parts.slice(1).join(' ') };
  }

  if (explicitLast) {
    return { name: parts[0], last_name: explicitLast };
  }

  return { name: parts[0], last_name: '' };
}

function normalizeImportRecord(
  picked: PickedRecord,
  segmentSet: Set<string>,
):
  | { ok: true; value: Omit<ImportContactRow, 'attributes'> }
  | { ok: false; message: string } {
  const names = resolveNameForImport(picked);
  if ('error' in names) {
    return { ok: false, message: names.error };
  }

  const segmentList = parseSegmentListFromImportCell(picked.segment);
  const prefixRaw = picked.prefix;
  const hasPrefixCol =
    prefixRaw !== undefined && prefixRaw !== null && String(prefixRaw).trim() !== '';
  const prefixDigits = hasPrefixCol ? normalizeDigits(prefixRaw) : '';
  const phoneDigits = normalizeDigits(picked.phone);

  let fullPhone = '';
  if (prefixDigits.length > 0) {
    fullPhone = prefixDigits + phoneDigits;
  } else if (phoneDigits.length === 9 && PERU_LOCAL_MOBILE.test(phoneDigits)) {
    fullPhone = DEFAULT_PE_PREFIX + phoneDigits;
  } else if (E164_NO_PLUS_REGEX.test(phoneDigits)) {
    fullPhone = phoneDigits;
  } else {
    return {
      ok: false,
      message:
        'Teléfono: use 9 dígitos móvil PE (982160981), E.164 sin +, o columna prefix para internacional',
    };
  }

  const validated = validateContactCore(
    names.name,
    names.last_name,
    fullPhone,
    segmentList,
    segmentSet,
    1,
  );
  if (!validated.ok) {
    return { ok: false, message: validated.message };
  }

  if (validated.value.name.length > MAX_CONTACT_NAME_LEN) {
    return {
      ok: false,
      message: `Nombre inválido (1-${MAX_CONTACT_NAME_LEN} caracteres)`,
    };
  }

  return {
    ok: true,
    value: {
      name: validated.value.name,
      last_name: validated.value.last_name,
      phone: validated.value.phone,
      segments: validated.value.segments,
      email: (() => {
        const raw = String(picked.email ?? '')
          .trim()
          .toLowerCase();
        return raw || null;
      })(),
      dni: (() => {
        const raw = String(picked.dni ?? '')
          .trim()
          .replace(/\s+/g, '');
        return raw ? raw.slice(0, 32) : null;
      })(),
    },
  };
}

function dedupeRowsByPhone(rows: ImportContactRow[]): ImportContactRow[] {
  const byPhone = new Map<string, ImportContactRow>();
  for (const row of rows) {
    byPhone.set(row.phone, row);
  }
  return [...byPhone.values()];
}

export function detectDuplicatePhones(
  rows: ImportContactRow[],
  sampleSize = 3,
) {
  const freq = new Map<string, number>();
  for (const row of rows) {
    freq.set(row.phone, (freq.get(row.phone) ?? 0) + 1);
  }
  const repeated = [...freq.entries()].filter(([, count]) => count > 1);
  const repeatedRows = repeated.reduce((acc, [, count]) => acc + count, 0);
  return {
    repeatedPhonesCount: repeated.length,
    repeatedRowsCount: repeatedRows,
    samplePhones: repeated
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, sampleSize)
      .map(([phone]) => phone),
  };
}

export function parseContactCsvBuffer(
  buffer: Buffer,
  segmentSet: Set<string>,
): ImportParseResult {
  const text = buffer.toString('utf8');
  const records = parseCsv(text, {
    columns: (header: string[]) =>
      header.map((cell) =>
        String(cell ?? '')
          .toLowerCase()
          .trim()
          .replace(/^\uFEFF/, ''),
      ),
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    bom: true,
  }) as Record<string, unknown>[];

  const rows: ImportContactRow[] = [];
  const errors: ImportParseError[] = [];

  for (let i = 0; i < records.length; i++) {
    const picked = pickContactFieldsFromRecord(records[i]);
    const parsed = normalizeImportRecord(picked, segmentSet);
    if (!parsed.ok) {
      errors.push({ line: i + 2, message: parsed.message });
      continue;
    }
    rows.push({ ...parsed.value, attributes: picked.attributes });
  }

  const duplicates = detectDuplicatePhones(rows);
  return {
    rows: dedupeRowsByPhone(rows),
    errors,
    duplicate_phones_in_file: duplicates.repeatedPhonesCount,
    duplicate_rows_in_file: duplicates.repeatedRowsCount,
    duplicate_phone_examples: duplicates.samplePhones,
  };
}

export function parseContactXlsxBuffer(
  buffer: Buffer,
  segmentSet: Set<string>,
): ImportParseResult {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return {
      rows: [],
      errors: [{ line: 1, message: 'Excel sin hojas' }],
      duplicate_phones_in_file: 0,
      duplicate_rows_in_file: 0,
      duplicate_phone_examples: [],
    };
  }

  const sheet = workbook.Sheets[sheetName];
  const records = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  });

  const rows: ImportContactRow[] = [];
  const errors: ImportParseError[] = [];

  for (let i = 0; i < records.length; i++) {
    const picked = pickContactFieldsFromRecord(records[i]);
    const parsed = normalizeImportRecord(picked, segmentSet);
    if (!parsed.ok) {
      errors.push({ line: i + 2, message: parsed.message });
      continue;
    }
    rows.push({ ...parsed.value, attributes: picked.attributes });
  }

  const duplicates = detectDuplicatePhones(rows);
  return {
    rows: dedupeRowsByPhone(rows),
    errors,
    duplicate_phones_in_file: duplicates.repeatedPhonesCount,
    duplicate_rows_in_file: duplicates.repeatedRowsCount,
    duplicate_phone_examples: duplicates.samplePhones,
  };
}

export function buildContactImportSampleXlsxBuffer(): Buffer {
  const rows = [
    {
      name: 'María',
      last_name: 'García López',
      phone: '982160981',
      email: 'maria.garcia@example.com',
      dni: '12345678',
      segment: 'suscriptor_1',
      prefix: '',
      sede: 'Lima Norte',
      monto: '150.00',
      fecha_pago: '2025-01-15',
    },
    {
      name: 'Juan',
      last_name: 'Pérez',
      phone: '987654321',
      email: '',
      dni: '',
      segment: 'suscriptor_1;suscriptor_2',
      prefix: '',
      sede: '',
      monto: '',
      fecha_pago: '',
    },
    {
      name: 'Ana',
      last_name: 'Torres',
      phone: '51911111111',
      email: 'ana.torres@example.com',
      dni: '87654321',
      segment: 'suscriptor_1,suscriptor_2,suscriptor_3',
      prefix: '',
      sede: 'Cusco',
      monto: '200',
      fecha_pago: '',
    },
    {
      name: 'Carlos',
      last_name: 'Díaz',
      phone: '51922222222',
      email: '',
      dni: '11223344',
      segment: 'suscriptor_2',
      prefix: '',
      sede: '',
      monto: '',
      fecha_pago: '',
    },
    {
      name: 'Laura',
      last_name: 'Smith',
      phone: '5551234567',
      email: 'laura.smith@example.com',
      dni: '',
      segment: 'suscriptor_1',
      prefix: '1',
      sede: '',
      monto: '',
      fecha_pago: '',
    },
  ];

  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Contactos');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}
