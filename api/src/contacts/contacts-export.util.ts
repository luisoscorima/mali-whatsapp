import * as XLSX from 'xlsx';
import { exportFilenameDateStamp } from '../campaigns/campaign-format.util';
import { safeFilenamePart } from '../conversations/conversation-export.util';

const BASE_HEADERS = ['Nombre', 'Teléfono', 'Segmentos'];

export type ContactExportRow = {
  id: number;
  name: string;
  phone: string;
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
    for (const k of Object.keys(attrs)) keys.add(k);
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
        String(c.phone || ''),
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
    { wch: 18 },
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

export function safeExportFilenamePart(value: string): string {
  return safeFilenamePart(value);
}
