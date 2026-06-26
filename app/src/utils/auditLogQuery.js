const { auditCreatedDateSql } = require('./auditSqlDate');

/** Filtros de bitácora reutilizables (lista, export TXT). */
function buildAuditLogWhere(q, opts = {}) {
  const level = String(q.level || '').trim().toLowerCase();
  const event = String(q.event || '').trim();
  const from = String(q.from || '').trim();
  const to = String(q.to || '').trim();
  const areaScope = opts.areaScope ? String(opts.areaScope).trim().toLowerCase() : '';
  const where = [];
  const params = [];
  let n = 1;

  if (areaScope) {
    where.push(`area = $${n}`);
    params.push(areaScope);
    n += 1;
  }
  if (opts.excludeMasterActors) {
    where.push(`NOT EXISTS (
      SELECT 1 FROM users u
      WHERE u.is_master = TRUE
        AND (
          u.id = actor_user_id
          OR (
            actor_user_id IS NULL
            AND actor_email IS NOT NULL
            AND LOWER(u.email) = LOWER(actor_email)
          )
        )
    )`);
  }
  if (['info', 'warn', 'error'].includes(level)) {
    where.push(`level = $${n}`);
    params.push(level);
    n += 1;
  }
  if (event) {
    if (event.includes('.')) {
      where.push(`event_type = $${n}`);
      params.push(event);
      n += 1;
    } else {
      where.push(`event_type LIKE $${n}`);
      params.push(`${event}.%`);
      n += 1;
    }
  }
  const dateExpr = auditCreatedDateSql();
  if (/^\d{4}-\d{2}-\d{2}$/.test(from)) {
    where.push(`${dateExpr} >= $${n}::date`);
    params.push(from);
    n += 1;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    where.push(`${dateExpr} <= $${n}::date`);
    params.push(to);
    n += 1;
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  return {
    whereSql,
    params,
    filters: { level, event, from, to },
  };
}

function auditAreaScopeForUser(user) {
  if (!user || user.isMaster) return null;
  if (user.canViewAuditLogs) return user.area;
  return null;
}

function auditLogQueryOptsForUser(user) {
  if (!user || user.isMaster) {
    return { areaScope: null, excludeMasterActors: false };
  }
  if (!user.canViewAuditLogs) {
    return { areaScope: null, excludeMasterActors: false };
  }
  return {
    areaScope: user.area,
    excludeMasterActors: true,
  };
}

function summarizeMetaForAuditRow(meta) {
  if (!meta || typeof meta !== 'object') return '—';
  try {
    const s = JSON.stringify(meta);
    if (s.length <= 200) return s;
    return `${s.slice(0, 197)}…`;
  } catch {
    return '—';
  }
}

const AUDIT_LEVEL_OPTIONS = [
  { value: '', label: 'Todos los niveles' },
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'error', label: 'error' },
];

const AUDIT_EVENT_GROUP_OPTIONS = [
  { value: '', label: 'Todos los tipos' },
  { value: 'auth', label: 'Autenticación' },
  { value: 'admin', label: 'Administración' },
  { value: 'segment', label: 'Segmentos' },
  { value: 'contact', label: 'Contactos' },
  { value: 'campaign', label: 'Campañas' },
  { value: 'template', label: 'Plantillas' },
  { value: 'conversation', label: 'Conversaciones' },
  { value: 'settings', label: 'Ajustes IA' },
];

module.exports = {
  buildAuditLogWhere,
  auditAreaScopeForUser,
  auditLogQueryOptsForUser,
  summarizeMetaForAuditRow,
  AUDIT_LEVEL_OPTIONS,
  AUDIT_EVENT_GROUP_OPTIONS,
};
