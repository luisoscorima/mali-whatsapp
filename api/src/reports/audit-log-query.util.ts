const DISPLAY_TIMEZONE =
  String(process.env.DISPLAY_TIMEZONE || 'America/Lima').trim() ||
  'America/Lima';

export function getAuditDisplayTimeZone(): string {
  if (!/^[A-Za-z0-9_/+-]+$/.test(DISPLAY_TIMEZONE)) {
    return 'America/Lima';
  }
  return DISPLAY_TIMEZONE;
}

export function auditCreatedDateSql(): string {
  const tz = getAuditDisplayTimeZone().replace(/'/g, "''");
  return `(audit_logs.created_at AT TIME ZONE '${tz}')::date`;
}

export const AUDIT_LEVEL_OPTIONS = [
  { value: '', label: 'Todos los niveles' },
  { value: 'info', label: 'info' },
  { value: 'warn', label: 'warn' },
  { value: 'error', label: 'error' },
] as const;

export const AUDIT_EVENT_GROUP_OPTIONS = [
  { value: '', label: 'Todos los tipos' },
  { value: 'auth', label: 'Autenticación' },
  { value: 'admin', label: 'Administración' },
  { value: 'segment', label: 'Segmentos' },
  { value: 'contact', label: 'Contactos' },
  { value: 'campaign', label: 'Campañas' },
  { value: 'template', label: 'Plantillas' },
  { value: 'conversation', label: 'Conversaciones' },
  { value: 'settings', label: 'Ajustes IA' },
] as const;

export type AuditLogFilters = {
  level: string;
  event: string;
  from: string;
  to: string;
};

export type AuditLogQueryOpts = {
  areaScope: string | null;
  excludeMasterActors: boolean;
};

export function auditLogQueryOptsForUser(user: {
  isMaster: boolean;
  canViewAuditLogs: boolean;
  area: string;
}): AuditLogQueryOpts {
  if (user.isMaster) {
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

export function summarizeMetaForAuditRow(meta: unknown): string {
  if (!meta || typeof meta !== 'object') return '—';
  try {
    const s = JSON.stringify(meta);
    if (s.length <= 200) return s;
    return `${s.slice(0, 197)}…`;
  } catch {
    return '—';
  }
}

export function buildAuditLogWhere(
  q: Record<string, string | undefined>,
  opts: AuditLogQueryOpts = { areaScope: null, excludeMasterActors: false },
): {
  whereSql: string;
  params: unknown[];
  filters: AuditLogFilters;
} {
  const level = String(q.level || '')
    .trim()
    .toLowerCase();
  const event = String(q.event || '').trim();
  const from = String(q.from || '').trim();
  const to = String(q.to || '').trim();
  const areaScope = opts.areaScope
    ? String(opts.areaScope).trim().toLowerCase()
    : '';

  const where: string[] = [];
  const params: unknown[] = [];
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

export function readAuditRetentionDays(): number {
  const n = Number(process.env.AUDIT_LOG_RETENTION_DAYS || 30);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 30;
}
