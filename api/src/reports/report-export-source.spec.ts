import * as XLSX from 'xlsx';
import { setMetaSettingsCache } from '../meta-settings/meta-settings.store';
import { buildContactCommunicationXlsxBuffer } from './contact-communication-export.util';
import { buildConversationHistoryXlsxBuffer } from './conversation-history-report.util';
import { buildSegmentHistoryXlsxBuffer } from './segment-history-report.util';
import { reportExportSourceCells } from './report-export-source.util';

describe('report export source', () => {
  beforeEach(() => {
    setMetaSettingsCache([
      { area: 'educacion_ca', key: 'meta.display_phone_number', value: '+51 902 043 388' },
      { area: 'pam', key: 'meta.display_phone_number', value: '+51 923 998 190' },
    ]);
  });

  afterEach(() => setMetaSettingsCache([]));

  it.each([
    ['communications', buildContactCommunicationXlsxBuffer],
    ['conversation history', buildConversationHistoryXlsxBuffer],
    ['segment history', buildSegmentHistoryXlsxBuffer],
  ] as const)('identifies the source in an empty %s workbook', (_name, build) => {
    const workbook = XLSX.read(build([], 'educacion_ca'), { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    expect(sheet.A1.v).toBe('Área');
    expect(sheet.B1.v).toBe('Número del área');
    expect(sheet.C1.v).toBeTruthy();
    expect(XLSX.utils.decode_range(sheet['!ref']!).e.r).toBe(0);
  });

  it('keeps report data below its original column headers', () => {
    const record = {
      id: '1', created_at: '2026-10-21T12:00:00Z', created_display: '21/10/2026',
      contact_id: 12, phone: '001234567', name: 'Ana', last_name: 'Pérez',
      dni: '00112233', email: '', added: 'Cursos', removed: '',
      segments: 'Cursos', actor_email: 'test@example.test',
    };
    const buffer = buildSegmentHistoryXlsxBuffer([record, { ...record, id: '2', name: 'Luis' }], 'educacion_ca');
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    expect(sheet.E1.v).toBe('Número');
    for (const row of [2, 3]) {
      expect(sheet[`A${row}`].v).toBe('Educación CA');
      expect(sheet[`B${row}`]).toMatchObject({ t: 's', v: '902043388' });
      expect(sheet[`E${row}`]).toMatchObject({ t: 's', v: '001234567' });
    }
    expect(sheet.F2.v).toBe('Ana');
    expect(sheet.F3.v).toBe('Luis');
    expect(reportExportSourceCells('pam')).toEqual(['PAM', '923998190']);
  });

  it('does not substitute another area or an internal phone ID for a missing number', () => {
    expect(reportExportSourceCells('educacion_ep')).toEqual([
      'Educación EP', 'Sin número configurado',
    ]);
  });
});
