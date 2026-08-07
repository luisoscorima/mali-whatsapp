import * as XLSX from 'xlsx';
import { exportFilenameDateStamp } from '../campaigns/campaign-format.util';
import { safeFilenamePart } from '../conversations/conversation-export.util';

const BASE_HEADERS = ['Nombre', 'Apellidos', 'Teléfono', 'Email', 'DNI', 'Segmentos'];

/** Slugs nativos que no deben salir como columnas de atributo dinámico. */
const NATIVE_ATTR_KEYS = new Set(['dni', 'email', 'correo']);

export type ContactExportRow = {
  id: number;
  name: string;
  last_name: string;
  phone: string;
  email: string | null;
  dni: string | null;
  segment_labels: string;
};

export function collectAttributeKeys(
  attrMap: Map<number, Record<string, string>>,
  contactIds: number[],
): string[] {
  const keys = new Set<string>();
  for (const id of contactIds) {
    const attrs = attrMap.get(id);
    if (!attrs) continue;
    for (const k of Object.keys(attrs)) {
      if (NATIVE_ATTR_KEYS.has(k)) continue;
      keys.add(k);
    }
  }
  return [...keys].sort();
}

export function buildContactsExportBuffer(
  contacts: ContactExportRow[],
  attrMap: Map<number, Record<string, string>>,
  { includeAttributes = true } = {},
): Buffer {
  const contactIds = contacts.map((c) => c.id);
  const attrKeys = includeAttributes
    ? collectAttributeKeys(attrMap, contactIds)
    : [];
  const headers = [...BASE_HEADERS, ...attrKeys];
  const aoa = [
    headers,
    ...contacts.map((c) => {
      const row = [
        String(c.name || ''),
        String(c.last_name || ''),
        String(c.phone || ''),
        String(c.email || ''),
        String(c.dni || ''),
        String(c.segment_labels || ''),
      ];
      if (includeAttributes) {
        const attrs = attrMap.get(c.id) || {};
        for (const k of attrKeys) row.push(String(attrs[k] ?? ''));
      }
      return row;
    }),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 28 },
    { wch: 28 },
    { wch: 18 },
    { wch: 28 },
    { wch: 16 },
    { wch: 36 },
    ...attrKeys.map(() => ({ wch: 20 })),
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Contactos');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function contactsExportFilename(prefix = 'contactos'): string {
  return `${prefix}-${exportFilenameDateStamp()}.xlsx`;
}

export function segmentContactsExportFilename(slug: string): string {
  return `segmento-${safeFilenamePart(slug)}-${exportFilenameDateStamp()}.xlsx`;
}

export function safeExportFilenamePart(value: string): string {
  return safeFilenamePart(value);
}
