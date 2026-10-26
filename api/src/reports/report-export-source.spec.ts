import * as XLSX from 'xlsx';
import { buildContactCommunicationXlsxBuffer } from './contact-communication-export.util';
import { buildConversationHistoryXlsxBuffer } from './conversation-history-report.util';
import { buildSegmentHistoryXlsxBuffer } from './segment-history-report.util';
import { reportExportSourceCells } from './report-export-source.util';

describe('report export source', () => {
  it.each([
    ['communications', buildContactCommunicationXlsxBuffer],
    ['conversation history', buildConversationHistoryXlsxBuffer],
    ['segment history', buildSegmentHistoryXlsxBuffer],
  ] as const)('identifies category and line in an empty %s workbook', (_name, build) => {
    const workbook = XLSX.read(build([], 'educacion'), { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    expect(sheet.A1.v).toBe('Categoría');
    expect(sheet.B1.v).toBe('Línea');
    expect(sheet.C1.v).toBeTruthy();
    expect(XLSX.utils.decode_range(sheet['!ref']!).e.r).toBe(0);
  });

  it('keeps the contact phone under its own header', () => {
    const record = {
      id: '1', created_at: '2026-10-21T12:00:00Z', created_display: '21/10/2026',
      contact_id: 12, phone: '001234567', name: 'Ana', last_name: 'Pérez',
      dni: '00112233', email: '', added: 'Cursos', removed: '',
      segments: 'Cursos', actor_email: 'test@example.test',
      category: 'ca', whatsapp_line: '',
    };
    const buffer = buildSegmentHistoryXlsxBuffer(
      [record, { ...record, id: '2', name: 'Luis', category: 'ep' }],
      'educacion',
    );
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    expect(sheet.E1.v).toBe('Número');
    expect(sheet.A2.v).toBe('CA');
    expect(sheet.B2.v).toBe('Sin línea');
    expect(sheet.A3.v).toBe('EP');
    expect(sheet.E2).toMatchObject({ t: 's', v: '001234567' });
    expect(sheet.F2.v).toBe('Ana');
    expect(sheet.F3.v).toBe('Luis');
  });

  it('uses the row category and line, not the area phone', () => {
    expect(reportExportSourceCells('educacion', {
      category: 'general',
      whatsapp_line: 'Educación · 51900000000',
    })).toEqual(['General', 'Educación · 51900000000']);
    expect(reportExportSourceCells('pam', {
      whatsapp_line: 'PAM · 51923998190',
    })).toEqual(['No aplica', 'PAM · 51923998190']);
    expect(reportExportSourceCells('educacion_ep')).toEqual(['Sin categoría', 'Sin línea']);
  });
});
