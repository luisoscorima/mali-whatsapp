const { logError } = require('../utils/logger');
const { syncTemplatesForArea } = require('../services/templateSync');
const { buildTemplateDefinition } = require('../services/templateParser');
const { templateSyncLimiter } = require('../middleware/limiters');

function registerTemplates(app, ctx) {
  const { query, appPath } = ctx;

  app.post('/templates/sync', templateSyncLimiter, async (req, res) => {
    try {
      await syncTemplatesForArea(req.user.area);
      res.redirect(`${appPath('/')}?templates_synced=1`);
    } catch (error) {
      logError(req, 'Error sincronizando plantillas', error);
      res
        .status(500)
        .send(
          `No se pudieron sincronizar plantillas: ${error.message}. Comprueba token y permisos de la app en Meta.`
        );
    }
  });

  app.get('/api/templates/:id/definition', async (req, res) => {
    const id = parseInt(String(req.params.id || '').trim(), 10);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: 'Id invalido' });
    }
    const r = await query(
      `SELECT id, name, language, category, status, components_json FROM whatsapp_templates WHERE id = $1 AND area = $2`,
      [id, req.user.area]
    );
    if (r.rowCount === 0) {
      return res.status(404).json({ ok: false, error: 'No encontrada' });
    }
    const def = buildTemplateDefinition(r.rows[0]);
    res.json({ ok: true, definition: def });
  });
}

module.exports = { registerTemplates };
