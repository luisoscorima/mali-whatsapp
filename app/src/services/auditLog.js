const { getRequestId } = require('../utils/logger');

/** Tipos de evento (prefijo.categoria). */
const AuditEvent = {
  AUTH_LOGIN: 'auth.login',
  AUTH_LOGOUT: 'auth.logout',
  AUTH_LOGIN_FAILED: 'auth.login_failed',
  AUTH_PASSWORD_CHANGE: 'auth.password_change',
  ADMIN_SWITCH_AREA: 'admin.switch_area',
  ADMIN_USER_CREATED: 'admin.user_created',
  ADMIN_USER_UPDATED: 'admin.user_updated',
  ADMIN_USER_DELETED: 'admin.user_deleted',
  ADMIN_USERS_BULK_IMPORT: 'admin.users_bulk_import',
  ADMIN_META_UPDATED: 'admin.meta_updated',
  SEGMENT_CREATED: 'segment.created',
  SEGMENT_UPDATED: 'segment.updated',
  SEGMENT_DELETED: 'segment.deleted',
  CONTACT_CREATED: 'contact.created',
  CONTACT_IMPORT: 'contact.import',
  CONTACT_BULK_SEGMENT: 'contact.bulk_segment',
  CONTACT_UPDATED: 'contact.updated',
  CONTACT_DELETED: 'contact.deleted',
  CAMPAIGN_CREATED: 'campaign.created',
  TEMPLATE_SYNC: 'template.sync',
  CONVERSATION_MODE: 'conversation.mode',
  CONVERSATION_REPLY: 'conversation.reply',
  CONVERSATION_EXPORT: 'conversation.export',
  CONTACT_LEAD_SCORE: 'contact.lead_score',
  SETTINGS_AI_CONFIG: 'settings.ai_config',
  SETTINGS_AI_ENABLE: 'settings.ai_enable',
};

function getClientIp(req) {
  if (!req || !req.get) return null;
  const xf = String(req.get('x-forwarded-for') || '')
    .split(',')[0]
    .trim();
  if (xf) return xf.slice(0, 128);
  const ip = req.ip || req.socket?.remoteAddress || '';
  return String(ip).slice(0, 128) || null;
}

function deepSanitize(value, depth = 0) {
  if (depth > 4) return '[truncado]';
  if (value == null) return value;
  if (typeof value === 'string') {
    if (value.length > 2000) return `${value.slice(0, 2000)}…`;
    return value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((x) => deepSanitize(x, depth + 1));
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const lk = k.toLowerCase();
    if (
      /password|secret|token|hash|credential|authorization|cookie|session/i.test(lk) ||
      lk.includes('whatsapp_token') ||
      lk.includes('app_secret') ||
      lk.includes('verify_token')
    ) {
      out[k] = '[omitido]';
      continue;
    }
    if (lk === 'prompt' && typeof v === 'string' && v.length > 200) {
      out[k] = `${v.slice(0, 200)}…`;
      continue;
    }
    out[k] = deepSanitize(v, depth + 1);
  }
  return out;
}

/**
 * Registra un evento de auditoría (no bloquea la petición si falla el INSERT).
 * @param {function} query - pool query
 * @param {object} opts
 */
async function auditLog(query, opts) {
  if (!query || !opts || !opts.event_type || !opts.message) return;
  const {
    req,
    level = 'info',
    event_type,
    message,
    meta = {},
    actor = null,
  } = opts;

  const actor_user_id =
    actor && Object.prototype.hasOwnProperty.call(actor, 'userId') ? actor.userId : req?.user?.id ?? null;
  const actor_email =
    actor && Object.prototype.hasOwnProperty.call(actor, 'email')
      ? actor.email
      : req?.user?.email ?? null;
  const area =
    actor && Object.prototype.hasOwnProperty.call(actor, 'area') ? actor.area : req?.user?.area ?? null;

  const client_ip = req ? getClientIp(req) : null;
  let request_id = null;
  try {
    request_id = req ? getRequestId(req) : null;
  } catch {
    request_id = null;
  }

  const safeMeta = deepSanitize(meta);
  let metaJson;
  try {
    metaJson = JSON.stringify(safeMeta || {});
  } catch {
    metaJson = '{}';
  }

  try {
    await query(
      `INSERT INTO audit_logs (level, event_type, message, actor_user_id, actor_email, area, client_ip, request_id, meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        level,
        String(event_type).slice(0, 100),
        String(message).slice(0, 4000),
        actor_user_id != null && Number.isFinite(Number(actor_user_id)) ? Number(actor_user_id) : null,
        actor_email ? String(actor_email).slice(0, 160) : null,
        area ? String(area).slice(0, 32) : null,
        client_ip,
        request_id ? String(request_id).slice(0, 64) : null,
        metaJson,
      ]
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'audit_logs insert failed',
        event_type,
        error: e?.message || String(e),
      })
    );
  }
}

function phoneMetaTail(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  if (d.length < 4) return null;
  return `…${d.slice(-4)}`;
}

/** Elimina filas de audit_logs más antiguas que AUDIT_LOG_RETENTION_Días (config). */
async function purgeOldAuditLogs(queryFn) {
  if (!queryFn) return;
  const appConfig = require('../config');
  const days = appConfig.AUDIT_LOG_RETENTION_DAYS;
  try {
    const r = await queryFn(
      `DELETE FROM audit_logs WHERE created_at < NOW() - ($1::int * INTERVAL '1 day')`,
      [days]
    );
    const deleted = Number(r.rowCount || 0);
    if (deleted > 0) {
      console.log(
        JSON.stringify({
          level: 'info',
          message: 'audit_logs purge',
          deleted,
          retention_days: days,
        })
      );
    }
  } catch (e) {
    console.error(
      JSON.stringify({
        level: 'error',
        message: 'audit_logs purge failed',
        error: e?.message || String(e),
      })
    );
  }
}

module.exports = { auditLog, AuditEvent, phoneMetaTail, purgeOldAuditLogs };
