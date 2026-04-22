const config = require('../config');

/** Zona IANA para filtros de fecha en bitácora (misma que el panel). */
function getAuditDisplayTimeZone() {
  const tz = String(config.DISPLAY_TIMEZONE || 'America/Lima').trim() || 'America/Lima';
  if (!/^[A-Za-z0-9_/+-]+$/.test(tz)) return 'America/Lima';
  return tz;
}

/** Expresión SQL: fecha calendario del instante en la zona del panel. */
function auditCreatedDateSql() {
  const tz = getAuditDisplayTimeZone().replace(/'/g, "''");
  return `(audit_logs.created_at AT TIME ZONE '${tz}')::date`;
}

module.exports = { getAuditDisplayTimeZone, auditCreatedDateSql };
