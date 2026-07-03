const DISPLAY_TIMEZONE =
  String(process.env.DISPLAY_TIMEZONE || 'America/Lima').trim() ||
  'America/Lima';

export function formatExportDate(isoOrDate: Date | string | null | undefined): string {
  if (!isoOrDate) return '';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PE', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: DISPLAY_TIMEZONE,
  });
}

export function exportFilenameDateStamp(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
}
