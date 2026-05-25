const { resolveWabaId, fetchAllApprovedTemplates, getWhatsAppCredentialsForArea } = require('./metaWhatsApp');

function normalizeArea(area) {
  const a = String(area || '').trim().toLowerCase();
  if (a === 'ti' || a === 'pam' || a === 'educacion') return a;
  return 'ti';
}

function buildApprovedTemplatesDeleteQuery(area, templates) {
  const keyClauses = [];
  const params = [area];
  for (const t of templates) {
    const name = String(t.name || '').trim();
    const language = String(t.language || '').trim();
    if (!name || !language) continue;
    params.push(name, language);
    const nameIdx = params.length - 1;
    const languageIdx = params.length;
    keyClauses.push(`(name = $${nameIdx} AND language = $${languageIdx})`);
  }

  if (keyClauses.length === 0) {
    return {
      sql: `DELETE FROM whatsapp_templates WHERE area = $1 AND UPPER(status) = 'APPROVED'`,
      params,
    };
  }

  return {
    sql: `DELETE FROM whatsapp_templates
          WHERE area = $1
            AND UPPER(status) = 'APPROVED'
            AND NOT (${keyClauses.join(' OR ')})`,
    params,
  };
}

/**
 * Sincroniza plantillas aprobadas manteniendo el id local si la plantilla sigue existiendo.
 */
async function syncTemplatesForArea(area) {
  const a = normalizeArea(area);
  const { token, phoneNumberId } = getWhatsAppCredentialsForArea(a);
  if (!token) {
    throw new Error('Falta token de WhatsApp para esta área');
  }

  const wabaId = await resolveWabaId(a, token, phoneNumberId);
  const templates = await fetchAllApprovedTemplates(wabaId, token);

  const { pool } = require('../db/pool');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    for (const t of templates) {
      const name = String(t.name || '').trim();
      const language = String(t.language || '').trim();
      const category = String(t.category || '').trim();
      const status = String(t.status || '').trim();
      const metaId = t.id != null ? String(t.id) : null;
      const components = Array.isArray(t.components) ? t.components : [];
      if (!name || !language) continue;
      await c.query(
        `INSERT INTO whatsapp_templates (area, meta_id, name, language, category, status, components_json, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())
         ON CONFLICT (area, name, language)
         DO UPDATE SET
           meta_id = EXCLUDED.meta_id,
           category = EXCLUDED.category,
           status = EXCLUDED.status,
           components_json = EXCLUDED.components_json,
           rejection_reason = NULL,
           synced_at = NOW()`,
        [a, metaId, name, language, category || null, status, JSON.stringify(components)]
      );
    }
    const staleDelete = buildApprovedTemplatesDeleteQuery(a, templates);
    await c.query(staleDelete.sql, staleDelete.params);
    await c.query('COMMIT');
    return { count: templates.length };
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { syncTemplatesForArea, normalizeArea };
