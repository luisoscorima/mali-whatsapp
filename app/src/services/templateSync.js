const { resolveWabaId, fetchAllApprovedTemplates, getWhatsAppCredentialsForArea } = require('./metaWhatsApp');

function normalizeArea(area) {
  const a = String(area || '').trim().toLowerCase();
  if (a === 'ti' || a === 'pam' || a === 'educacion') return a;
  return 'ti';
}

/**
 * Sincroniza plantillas aprobadas: reemplaza todas las filas del área por el resultado actual de Meta.
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
    await c.query(`DELETE FROM whatsapp_templates WHERE area = $1`, [a]);
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
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW())`,
        [a, metaId, name, language, category || null, status, JSON.stringify(components)]
      );
    }
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
