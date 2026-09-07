import * as XLSX from 'xlsx';
import { exportFilenameDateStamp } from '../campaigns/campaign-format.util';
import { safeFilenamePart } from '../conversations/conversation-export.util';

export function buildLeadsOriginsExportBuffer(
  rows: Array<{
    channel: string;
    contact_name: string;
    phone: string;
    email: string;
    dni: string;
    lead_status: string;
    source_label: string;
    source_key: string;
    curso: string;
    fuente: string;
    programa: string;
    external_id: string;
    last_seen_at: string;
  }>,
): Buffer {
  const headers = [
    'Canal',
    'Contacto',
    'Teléfono',
    'Email',
    'DNI',
    'Estado',
    'Fuente / form',
    'Source key',
    'Curso',
    'Fuente',
    'Programa',
    'External ID',
    'Último',
  ];
  const aoa = [
    headers,
    ...rows.map((r) => [
      r.channel,
      r.contact_name,
      r.phone,
      r.email,
      r.dni,
      r.lead_status,
      r.source_label,
      r.source_key,
      r.curso,
      r.fuente,
      r.programa,
      r.external_id,
      r.last_seen_at,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function leadsOriginsExportFilename(area: string): string {
  return `leads-${safeFilenamePart(area)}-${exportFilenameDateStamp()}.xlsx`;
}

export function buildMetaFormLeadsExportBuffer(
  rows: Array<{
    contact_name: string;
    phone: string;
    email: string;
    dni: string;
    lead_status: string;
    form_id: string;
    form_name: string;
    leadgen_id: string;
    created_time: string;
  }>,
): Buffer {
  const headers = [
    'Contacto',
    'Teléfono',
    'Email',
    'DNI',
    'Estado',
    'Form ID',
    'Formulario',
    'Leadgen ID',
    'Fecha',
  ];
  const aoa = [
    headers,
    ...rows.map((r) => [
      r.contact_name,
      r.phone,
      r.email,
      r.dni,
      r.lead_status,
      r.form_id,
      r.form_name,
      r.leadgen_id,
      r.created_time,
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Instant Forms');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function metaFormLeadsExportFilename(area: string): string {
  return `instant-forms-${safeFilenamePart(area)}-${exportFilenameDateStamp()}.xlsx`;
}
