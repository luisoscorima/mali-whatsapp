const config = require('../config');

/** IANA, p. ej. America/Lima — configurable con DISPLAY_TIMEZONE. */
const DISPLAY_TIMEZONE = String(config.DISPLAY_TIMEZONE || 'America/Lima').trim() || 'America/Lima';

/**
 * Lista de chats: hora si es hoy (en Lima), fecha corta si no.
 */
function formatChatListTime(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  const now = new Date();
  const tz = DISPLAY_TIMEZONE;
  const dayKey = (x) => x.toLocaleDateString('en-CA', { timeZone: tz });
  if (dayKey(date) === dayKey(now)) {
    return date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: tz });
  }
  const y1 = date.toLocaleDateString('en-CA', { timeZone: tz, year: 'numeric' });
  const y2 = now.toLocaleDateString('en-CA', { timeZone: tz, year: 'numeric' });
  if (y1 === y2) {
    return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', timeZone: tz });
  }
  return date.toLocaleDateString('es-PE', { day: '2-digit', month: 'short', year: '2-digit', timeZone: tz });
}

/** Fecha y hora cortas en zona del panel (mensajes, campañas programadas). */
function formatMessageDateTime(d) {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-PE', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: DISPLAY_TIMEZONE,
  });
}

/** Exportación Excel: fecha y hora legibles en zona del panel. */
function formatExportDate(isoOrDate) {
  if (!isoOrDate) return '';
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('es-PE', {
    dateStyle: 'short',
    timeStyle: 'medium',
    timeZone: DISPLAY_TIMEZONE,
  });
}

/** Sufijo YYYY-MM-DD del día actual en Lima (nombres de archivo). */
function exportFilenameDateStamp() {
  return new Date().toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE });
}

module.exports = {
  DISPLAY_TIMEZONE,
  formatChatListTime,
  formatMessageDateTime,
  formatExportDate,
  exportFilenameDateStamp,
};
