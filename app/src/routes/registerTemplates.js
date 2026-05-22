const config = require('../config');
const { logError } = require('../utils/logger');
const { auditLog, AuditEvent } = require('../services/auditLog');
const { syncTemplatesForArea } = require('../services/templateSync');
const { buildTemplateDefinition } = require('../services/templateParser');
const { createMessageTemplateOnWaba } = require('../services/metaWhatsApp');
const { templateSyncLimiter } = require('../middleware/limiters');
const { normalizeArea } = require('../middleware/auth');
const { resolveAppBaseUrl } = require('./shared/routeContext');

function registerTemplates(app, ctx) {
  const { query, appPath } = ctx;

  app.get('/templates', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const r = await query(
      `SELECT id, name, language, category, status, rejection_reason, submitted_at, synced_at
       FROM whatsapp_templates WHERE area = $1
       ORDER BY status ASC, name ASC`,
      [area]
    );
    res.render('templates-page', {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
      activeNav: 'templates',
      pageTitle: 'Plantillas WhatsApp · MALI',
      templates: r.rows,
      flash: req.query.flash || null,
      error: req.query.error || null,
    });
  });

  app.get('/templates/new', async (req, res) => {
    res.render('templates-new-page', {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
      activeNav: 'templates',
      pageTitle: 'Nueva plantilla · MALI WhatsApp',
      error: req.query.error || null,
    });
  });

  app.post('/templates/create', templateSyncLimiter, async (req, res) => {
    const area = normalizeArea(req.user.area);
    const name = String(req.body.name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 128);
    const language = String(req.body.language || 'es').trim();
    const category = String(req.body.category || 'MARKETING').trim().toUpperCase();
    const bodyText = String(req.body.bodyText || '').trim();

    if (!config.allowedTemplateNameRegex.test(name)) {
      return res.redirect(appPath('/templates/new?error=name'));
    }
    if (!bodyText) {
      return res.redirect(appPath('/templates/new?error=body'));
    }

    const varNums = [...new Set((bodyText.match(/\{\{(\d+)\}\}/g) || []).map((m) => parseInt(m.replace(/\D/g, ''), 10)))].sort(
      (a, b) => a - b
    );
    const maxVar = varNums.length ? Math.max(...varNums) : 0;
    const exampleRow = [];
    for (let i = 1; i <= maxVar; i++) {
      const fromField = String(req.body[`bodyExample_${i}`] || '').trim();
      const fallback = String(req.body.bodyExample || 'ejemplo').trim() || 'ejemplo';
      exampleRow.push(fromField || `${fallback}${i > 1 ? i : ''}`);
    }
    if (exampleRow.length === 0) {
      exampleRow.push(String(req.body.bodyExample || 'ejemplo').trim() || 'ejemplo');
    }

    const components = [
      {
        type: 'BODY',
        text: bodyText,
        example: { body_text: [exampleRow] },
      },
    ];

    try {
      const apiData = await createMessageTemplateOnWaba({
        area,
        name,
        language,
        category,
        components,
      });
      const metaId = apiData?.id != null ? String(apiData.id) : null;
      const status = String(apiData?.status || 'PENDING').trim().toUpperCase();
      await query(
        `INSERT INTO whatsapp_templates (area, meta_id, name, language, category, status, components_json, submitted_at, submitted_by, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), $8, NOW())
         ON CONFLICT (area, name, language)
         DO UPDATE SET meta_id = EXCLUDED.meta_id, status = EXCLUDED.status, category = EXCLUDED.category,
           components_json = EXCLUDED.components_json, submitted_at = NOW(), synced_at = NOW()`,
        [
          area,
          metaId,
          name,
          language,
          category,
          status,
          JSON.stringify(components),
          null,
        ]
      );
      auditLog(query, {
        req,
        event_type: AuditEvent.TEMPLATE_SYNC,
        message: `Plantilla enviada a revisión Meta: ${name}`,
        meta: { area, name, language, status },
      });
      res.redirect(appPath('/templates?flash=created'));
    } catch (error) {
      logError(req, 'Error creando plantilla en Meta', error);
      res.redirect(appPath(`/templates/new?error=${encodeURIComponent(error.message)}`));
    }
  });

  app.post('/templates/sync', templateSyncLimiter, async (req, res) => {
    try {
      await syncTemplatesForArea(req.user.area);
      auditLog(query, {
        req,
        event_type: AuditEvent.TEMPLATE_SYNC,
        message: `Sincronización de plantillas Meta (área ${req.user.area})`,
        meta: { area: req.user.area },
      });
      res.redirect(`${appPath('/campaigns/new')}?templates_synced=1`);
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
