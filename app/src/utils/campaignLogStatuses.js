/**
 * Estados en campaign_logs (Meta / webhook). Una fila tiene un único status actual.
 *
 * Salida OK: envío aceptado por la API de WhatsApp sin error registrado (sent | delivered | read).
 * Error: fallo de envío o entrega según registra la app / Meta.
 */

const SALIDA_OK_STATUSES = ['sent', 'delivered', 'read'];
const ERROR_STATUSES = ['error', 'failed', 'undelivered'];

/** Expresión SQL: estado normalizado (alias de columna `cl` en JOIN). */
const CAMPAIGN_LOG_STATUS_SQL = `LOWER(TRIM(COALESCE(cl.status, '')))`;

function sqlInList(statuses) {
  return `(${statuses.map((s) => `'${String(s)}'`).join(', ')})`;
}

module.exports = {
  SALIDA_OK_STATUSES,
  ERROR_STATUSES,
  CAMPAIGN_LOG_STATUS_SQL,
  sqlInList,
};
