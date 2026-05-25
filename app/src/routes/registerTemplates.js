const config = require('../config');
const { logError } = require('../utils/logger');
const { auditLog, AuditEvent } = require('../services/auditLog');
const { syncTemplatesForArea } = require('../services/templateSync');
const {
  buildTemplateDefinition,
  extractTemplateDisplayContent,
  templateStatusAllowsEdit,
  rebuildComponentsWithBody,
} = require('../services/templateParser');
const { createMessageTemplateOnWaba } = require('../services/metaWhatsApp');
const { templateSyncLimiter } = require('../middleware/limiters');
const { normalizeArea } = require('../middleware/auth');
const { resolveAppBaseUrl } = require('./shared/routeContext');

function buildBodyExampleRow(bodyText, reqBody) {
  const varNums = [...new Set((bodyText.match(/\{\{(\d+)\}\}/g) || []).map((m) => parseInt(m.replace(/\D/g, ''), 10)))].sort(
    (a, b) => a - b
  );
  const maxVar = varNums.length ? Math.max(...varNums) : 0;
  const exampleRow = [];
  for (let i = 1; i <= maxVar; i++) {
    const fromField = String(reqBody[`bodyExample_${i}`] || '').trim();
    const fallback = String(reqBody.bodyExample || 'ejemplo').trim() || 'ejemplo';
    exampleRow.push(fromField || `${fallback}${i > 1 ? i : ''}`);
  }
  if (exampleRow.length === 0 && bodyText.includes('{{')) {
    exampleRow.push(String(reqBody.bodyExample || 'ejemplo').trim() || 'ejemplo');
  }
  return exampleRow;
}

function registerTemplates(app, ctx) {
  const { query, appPath } = ctx;

  async function loadAllTemplates(area) {
    const r = await query(
      `SELECT id, name, language, category, status, rejection_reason, submitted_at, synced_at
       FROM whatsapp_templates WHERE area = $1
       ORDER BY status ASC, name ASC`,
      [normalizeArea(area)]
    );
    return r.rows;
  }

  async function loadTemplateById(area, id) {
    const r = await query(
      `SELECT id, meta_id, name, language, category, status, rejection_reason,
              components_json, submitted_at, synced_at
       FROM whatsapp_templates WHERE id = $1 AND area = $2`,
      [id, normalizeArea(area)]
    );
    return r.rows[0] || null;
  }

  async function findTemplateReplacementId(area, template) {
    if (!template) return null;
    const a = normalizeArea(area);
    if (template.meta_id) {
      const byMeta = await query(
        `SELECT id FROM whatsapp_templates
         WHERE area = $1 AND meta_id = $2
         ORDER BY id DESC
         LIMIT 1`,
        [a, String(template.meta_id)]
      );
      if (byMeta.rows[0]?.id) return byMeta.rows[0].id;
    }
    if (template.name && template.language) {
      const byName = await query(
        `SELECT id FROM whatsapp_templates
         WHERE area = $1 AND name = $2 AND language = $3
         ORDER BY CASE WHEN UPPER(status) = 'APPROVED' THEN 0 ELSE 1 END, id DESC
         LIMIT 1`,
        [a, template.name, template.language]
      );
      if (byName.rows[0]?.id) return byName.rows[0].id;
    }
    return null;
  }

  async function resolveTemplateRedirectIdAfterSync(area, templateId, previousTemplate) {
    if (!Number.isInteger(templateId) || templateId <= 0) return null;
    const existingTemplate = await loadTemplateById(area, templateId);
    if (existingTemplate) return existingTemplate.id;
    return findTemplateReplacementId(area, previousTemplate);
  }

  function renderTemplatesPage(req, res, opts) {
    const {
      view,
      templates,
      selectedTemplate = null,
      templateDisplay = null,
      templateCanEdit = false,
      flash,
      error,
    } = opts;
    const templatesSynced = String(req.query.templates_synced || '') === '1';
    const templatesSyncError = String(req.query.templates_sync_error || '').trim() || null;
    const selectedTemplateId = selectedTemplate ? selectedTemplate.id : null;

    let pageTitle = 'Plantillas WhatsApp · MALI';
    if (view === 'new') pageTitle = 'Nueva plantilla · MALI WhatsApp';
    if (view === 'detail' && selectedTemplate) {
      pageTitle = `${selectedTemplate.name} · Plantillas`;
    }

    res.render('templates-page', {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
      activeNav: 'templates',
      pageTitle,
      view,
      templates,
      selectedTemplateId,
      selectedTemplate,
      templateDisplay,
      templateCanEdit,
      flash: flash || null,
      error: error || null,
      templatesSynced,
      templatesSyncError,
    });
  }

  app.get('/templates', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const templates = await loadAllTemplates(area);
    renderTemplatesPage(req, res, {
      view: 'list',
      templates,
      flash: req.query.flash || null,
      error: req.query.error || null,
    });
  });

  app.get('/templates/new', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const templates = await loadAllTemplates(area);
    renderTemplatesPage(req, res, {
      view: 'new',
      templates,
      flash: req.query.flash || null,
      error: req.query.error || null,
    });
  });

  app.get('/templates/:id', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).send('Plantilla no encontrada');
    }
    const [templates, selectedTemplate] = await Promise.all([
      loadAllTemplates(area),
      loadTemplateById(area, id),
    ]);
    if (!selectedTemplate) {
      return res.status(404).send('Plantilla no encontrada');
    }
    const components = Array.isArray(selectedTemplate.components_json)
      ? selectedTemplate.components_json
      : typeof selectedTemplate.components_json === 'string'
        ? JSON.parse(selectedTemplate.components_json)
        : [];
    const templateDisplay = extractTemplateDisplayContent(components);
    renderTemplatesPage(req, res, {
      view: 'detail',
      templates,
      selectedTemplate,
      templateDisplay,
      templateCanEdit: templateStatusAllowsEdit(selectedTemplate.status),
      flash: req.query.flash || null,
      error: req.query.error ? decodeURIComponent(String(req.query.error)) : null,
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

    const exampleRow = buildBodyExampleRow(bodyText, req.body);
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
      const ins = await query(
        `INSERT INTO whatsapp_templates (area, meta_id, name, language, category, status, components_json, submitted_at, submitted_by, synced_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, NOW(), $8, NOW())
         ON CONFLICT (area, name, language)
         DO UPDATE SET meta_id = EXCLUDED.meta_id, status = EXCLUDED.status, category = EXCLUDED.category,
           components_json = EXCLUDED.components_json, submitted_at = NOW(), rejection_reason = NULL, synced_at = NOW()
         RETURNING id`,
        [area, metaId, name, language, category, status, JSON.stringify(components), null]
      );
      const newId = ins.rows[0]?.id;
      auditLog(query, {
        req,
        event_type: AuditEvent.TEMPLATE_SYNC,
        message: `Plantilla enviada a revisión Meta: ${name}`,
        meta: { area, name, language, status },
      });
      res.redirect(
        appPath(newId ? `/templates/${newId}?flash=created` : '/templates?flash=created')
      );
    } catch (error) {
      logError(req, 'Error creando plantilla en Meta', error);
      res.redirect(appPath(`/templates/new?error=${encodeURIComponent(error.message)}`));
    }
  });

  app.post('/templates/:id/update', templateSyncLimiter, async (req, res) => {
    const area = normalizeArea(req.user.area);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send('Id inválido');
    }
    const row = await loadTemplateById(area, id);
    if (!row) {
      return res.status(404).send('Plantilla no encontrada');
    }
    if (!templateStatusAllowsEdit(row.status)) {
      return res.redirect(appPath(`/templates/${id}?error=${encodeURIComponent('Esta plantilla no se puede editar en su estado actual')}`));
    }

    const bodyText = String(req.body.bodyText || '').trim();
    const category = String(req.body.category || row.category || 'MARKETING').trim().toUpperCase();
    if (!bodyText) {
      return res.redirect(appPath(`/templates/${id}?error=${encodeURIComponent('El cuerpo no puede estar vacío')}`));
    }

    const componentsRaw = Array.isArray(row.components_json)
      ? row.components_json
      : typeof row.components_json === 'string'
        ? JSON.parse(row.components_json)
        : [];
    const exampleRow = buildBodyExampleRow(bodyText, req.body);
    const components = rebuildComponentsWithBody(componentsRaw, bodyText, exampleRow);

    try {
      const apiData = await createMessageTemplateOnWaba({
        area,
        name: row.name,
        language: row.language,
        category,
        components,
      });
      const metaId = apiData?.id != null ? String(apiData.id) : row.meta_id;
      const status = String(apiData?.status || 'PENDING').trim().toUpperCase();
      await query(
        `UPDATE whatsapp_templates SET
           meta_id = $1, category = $2, status = $3, components_json = $4::jsonb,
           rejection_reason = NULL, submitted_at = NOW(), synced_at = NOW()
         WHERE id = $5 AND area = $6`,
        [metaId, category, status, JSON.stringify(components), id, area]
      );
      auditLog(query, {
        req,
        event_type: AuditEvent.TEMPLATE_SYNC,
        message: `Plantilla reenviada a revisión Meta: ${row.name}`,
        meta: { area, id, status },
      });
      res.redirect(appPath(`/templates/${id}?flash=updated`));
    } catch (error) {
      logError(req, 'Error actualizando plantilla en Meta', error);
      res.redirect(appPath(`/templates/${id}?error=${encodeURIComponent(error.message)}`));
    }
  });

  app.post('/templates/sync', templateSyncLimiter, async (req, res) => {
    const area = normalizeArea(req.user.area);
    const returnTo = String(req.body.returnTo || 'templates').trim().toLowerCase();
    const templateId = Number(req.body.templateId);
    const previousTemplate =
      Number.isInteger(templateId) && templateId > 0
        ? await loadTemplateById(area, templateId)
        : null;
    const detailSuffix =
      Number.isInteger(templateId) && templateId > 0 ? `/${templateId}` : '';
    try {
      await syncTemplatesForArea(area);
      auditLog(query, {
        req,
        event_type: AuditEvent.TEMPLATE_SYNC,
        message: `Sincronización de plantillas Meta (área ${area})`,
        meta: { area },
      });
      let redirectPath = '/templates?templates_synced=1';
      if (returnTo === 'campaigns' || returnTo === 'campaigns/new') {
        redirectPath = '/campaigns/new?templates_synced=1';
      } else {
        const redirectTemplateId = await resolveTemplateRedirectIdAfterSync(area, templateId, previousTemplate);
        if (redirectTemplateId) {
          redirectPath = `/templates/${redirectTemplateId}?templates_synced=1`;
        }
      }
      res.redirect(appPath(redirectPath));
    } catch (error) {
      logError(req, 'Error sincronizando plantillas', error);
      const errQ = encodeURIComponent(error.message);
      if (returnTo === 'campaigns' || returnTo === 'campaigns/new') {
        return res.redirect(appPath(`/campaigns/new?templates_sync_err=${errQ}`));
      }
      res.redirect(appPath(`/templates${detailSuffix}?templates_sync_error=${errQ}`));
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
