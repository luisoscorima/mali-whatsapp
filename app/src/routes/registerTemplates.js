const path = require('path');
const axios = require('axios');
const config = require('../config');
const { logError } = require('../utils/logger');
const { auditLog, AuditEvent } = require('../services/auditLog');
const { syncTemplatesForArea } = require('../services/templateSync');
const {
  buildTemplateDefinition,
  extractTemplateDisplayContent,
  templateStatusAllowsEdit,
} = require('../services/templateParser');
const {
  createMessageTemplateOnWaba,
  classifyTemplateHeaderUpload,
  uploadTemplateHeaderHandle,
} = require('../services/metaWhatsApp');
const { templateSyncLimiter } = require('../middleware/limiters');
const { normalizeArea } = require('../middleware/auth');
const { resolveAppBaseUrl } = require('./shared/routeContext');
const {
  buildTemplateBuilderState,
  compileTemplateBuilderPayload,
  hasPlaceholderAliases,
  parseStoredPlaceholderAliases,
  parseTemplateBuilderPayload,
} = require('../services/templateBuilder');

function decodeMaybeUriComponent(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function parseComponentsJson(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

function buildTemplateAliasSummary(def) {
  if (!def || !def.placeholderAliases) return [];
  const items = [];
  def.headerParamDefs.forEach((item) => {
    if (!item.alias) return;
    items.push({ scope: 'Cabecera', alias: item.alias, placeholder: item.placeholder });
  });
  def.bodyParamDefs.forEach((item) => {
    if (!item.alias) return;
    items.push({ scope: 'Cuerpo', alias: item.alias, placeholder: item.placeholder });
  });
  def.buttonParamDefs.forEach((item) => {
    if (!item.alias) return;
    items.push({ scope: 'Botón URL', alias: item.alias, placeholder: item.placeholder });
  });
  return items;
}

function guessFilenameFromUrl(urlStr, fallbackExt) {
  try {
    const parsed = new URL(urlStr);
    const fromPath = path.basename(parsed.pathname || '');
    if (fromPath && fromPath !== '/') return decodeURIComponent(fromPath);
  } catch {
    /* */
  }
  return `template-header${fallbackExt || ''}`;
}

async function downloadTemplateMediaFromUrl(urlStr) {
  let parsed;
  try {
    parsed = new URL(String(urlStr || '').trim());
  } catch {
    throw new Error('La URL del archivo de ejemplo no es válida.');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('La URL del archivo de ejemplo debe empezar con http:// o https://');
  }

  let response;
  try {
    response = await axios.get(parsed.toString(), {
      responseType: 'arraybuffer',
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 30000,
    });
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status) {
      throw new Error(`No se pudo descargar el archivo de ejemplo (HTTP ${error.response.status}).`);
    }
    throw new Error('No se pudo descargar el archivo de ejemplo.');
  }

  const mimeType = String(response.headers['content-type'] || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  const { format } = classifyTemplateHeaderUpload(mimeType, response.data?.byteLength || 0);
  const fallbackExt = format === 'IMAGE' ? '.jpg' : format === 'VIDEO' ? '.mp4' : '.pdf';
  return {
    buffer: Buffer.from(response.data),
    mimeType,
    format,
    filename: guessFilenameFromUrl(parsed.toString(), fallbackExt),
  };
}

function registerTemplates(app, ctx) {
  const { query, appPath } = ctx;

  async function loadAllTemplates(area) {
    const r = await query(
      `SELECT id, name, language, category, status, rejection_reason, submitted_at, synced_at
       FROM whatsapp_templates WHERE area = $1
       ORDER BY COALESCE(submitted_at, synced_at) DESC, id DESC`,
      [normalizeArea(area)]
    );
    return r.rows;
  }

  async function loadTemplateById(area, id) {
    const r = await query(
      `SELECT id, meta_id, name, language, category, status, rejection_reason,
              components_json, placeholder_aliases_json, submitted_at, synced_at
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

  function redirectPathForCreateError(sourceTemplateId) {
    return Number.isInteger(sourceTemplateId) && sourceTemplateId > 0
      ? `/templates/new?duplicate_from=${sourceTemplateId}`
      : '/templates/new';
  }

  async function compileBuilderForArea(area, reqBody) {
    const builderPayload = parseTemplateBuilderPayload(reqBody);
    return compileTemplateBuilderPayload(builderPayload, {
      resolveHeaderMediaHandle: async ({ format, exampleMediaUrl, existingHandle }) => {
        const keepHandle = String(existingHandle || '').trim();
        const url = String(exampleMediaUrl || '').trim();
        if (!url) {
          if (keepHandle) return keepHandle;
          throw new Error('La cabecera media requiere una URL pública de ejemplo para revisión en Meta.');
        }
        const media = await downloadTemplateMediaFromUrl(url);
        if (media.format !== String(format || '').trim().toUpperCase()) {
          throw new Error(`La URL de ejemplo no corresponde a una cabecera ${String(format || '').toUpperCase()}.`);
        }
        return uploadTemplateHeaderHandle({
          area,
          buffer: media.buffer,
          mimeType: media.mimeType,
          filename: media.filename,
        });
      },
    });
  }

  function renderTemplatesPage(req, res, opts) {
    const {
      view,
      templates,
      selectedTemplate = null,
      duplicateSourceTemplate = null,
      initialName = '',
      initialLanguage = '',
      templateDisplay = null,
      templateDefinition = null,
      templateAliasSummary = [],
      templateBuilderState = null,
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
      duplicateSourceTemplate,
      initialName,
      initialLanguage,
      templateDisplay,
      templateDefinition,
      templateAliasSummary,
      templateBuilderState,
      templateCanEdit,
      flash: flash || null,
      error: error || null,
      templatesSynced,
      templatesSyncError,
      extraHeadScripts:
        view === 'new' || view === 'detail' ? [`${config.basePath || ''}/js/template-builder.js`] : null,
    });
  }

  app.get('/templates', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const templates = await loadAllTemplates(area);
    renderTemplatesPage(req, res, {
      view: 'list',
      templates,
      flash: req.query.flash || null,
      error: decodeMaybeUriComponent(req.query.error),
    });
  });

  app.get('/templates/new', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const duplicateFromId = Number.parseInt(String(req.query.duplicate_from || '').trim(), 10);
    const [templates, duplicateSourceTemplate] = await Promise.all([
      loadAllTemplates(area),
      Number.isInteger(duplicateFromId) && duplicateFromId > 0
        ? loadTemplateById(area, duplicateFromId)
        : Promise.resolve(null),
    ]);
    const duplicateComponents = duplicateSourceTemplate
      ? parseComponentsJson(duplicateSourceTemplate.components_json)
      : [];
    renderTemplatesPage(req, res, {
      view: 'new',
      templates,
      flash: req.query.flash || null,
      error: decodeMaybeUriComponent(req.query.error),
      duplicateSourceTemplate,
      initialName: duplicateSourceTemplate ? `${duplicateSourceTemplate.name}_v2` : '',
      initialLanguage: duplicateSourceTemplate ? duplicateSourceTemplate.language : 'es',
      templateBuilderState: duplicateSourceTemplate
        ? buildTemplateBuilderState(
            duplicateComponents,
            parseStoredPlaceholderAliases(duplicateSourceTemplate.placeholder_aliases_json)
          )
        : buildTemplateBuilderState([], null),
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
    const components = parseComponentsJson(selectedTemplate.components_json);
    const templateDisplay = extractTemplateDisplayContent(components);
    const templateDefinition = buildTemplateDefinition(selectedTemplate);
    renderTemplatesPage(req, res, {
      view: 'detail',
      templates,
      selectedTemplate,
      templateDisplay,
      templateDefinition,
      templateAliasSummary: buildTemplateAliasSummary(templateDefinition),
      templateBuilderState: buildTemplateBuilderState(
        components,
        parseStoredPlaceholderAliases(selectedTemplate.placeholder_aliases_json)
      ),
      templateCanEdit: templateStatusAllowsEdit(selectedTemplate.status),
      flash: req.query.flash || null,
      error: decodeMaybeUriComponent(req.query.error),
    });
  });

  app.post('/templates/create', templateSyncLimiter, async (req, res) => {
    const area = normalizeArea(req.user.area);
    const sourceTemplateId = Number.parseInt(String(req.body.sourceTemplateId || '').trim(), 10);
    const sourceTemplate =
      Number.isInteger(sourceTemplateId) && sourceTemplateId > 0
        ? await loadTemplateById(area, sourceTemplateId)
        : null;
    const name = String(req.body.name || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .slice(0, 128);
    const language = String(req.body.language || 'es').trim();
    const category = String(req.body.category || 'MARKETING').trim().toUpperCase();

    if (!config.allowedTemplateNameRegex.test(name)) {
      return res.redirect(
        appPath(`${redirectPathForCreateError(sourceTemplate ? sourceTemplate.id : null)}?error=${encodeURIComponent('El nombre debe ir en snake_case.')}`)
      );
    }

    if (
      sourceTemplate &&
      String(sourceTemplate.name || '').trim().toLowerCase() === name &&
      String(sourceTemplate.language || '').trim() === language
    ) {
      return res.redirect(
        appPath(
          `/templates/new?duplicate_from=${sourceTemplate.id}&error=${encodeURIComponent('Para crear una nueva versión usa otro nombre o idioma distinto al original.')}`
        )
      );
    }

    try {
      const { components, placeholderAliases } = await compileBuilderForArea(area, req.body);
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
        `INSERT INTO whatsapp_templates (
           area, meta_id, name, language, category, status, components_json, placeholder_aliases_json,
           submitted_at, submitted_by, synced_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, NOW(), $9, NOW())
         ON CONFLICT (area, name, language)
         DO UPDATE SET
           meta_id = EXCLUDED.meta_id,
           status = EXCLUDED.status,
           category = EXCLUDED.category,
           components_json = EXCLUDED.components_json,
           placeholder_aliases_json = EXCLUDED.placeholder_aliases_json,
           submitted_at = NOW(),
           rejection_reason = NULL,
           synced_at = NOW()
         RETURNING id`,
        [
          area,
          metaId,
          name,
          language,
          category,
          status,
          JSON.stringify(components),
          JSON.stringify(placeholderAliases),
          null,
        ]
      );
      const newId = ins.rows[0]?.id;
      auditLog(query, {
        req,
        event_type: AuditEvent.TEMPLATE_SYNC,
        message: `Plantilla enviada a revisión Meta: ${name}`,
        meta: {
          area,
          name,
          language,
          status,
          has_aliases: hasPlaceholderAliases(placeholderAliases),
        },
      });
      res.redirect(appPath(newId ? `/templates/${newId}?flash=created` : '/templates?flash=created'));
    } catch (error) {
      logError(req, 'Error creando plantilla en Meta', error);
      res.redirect(
        appPath(
          `${redirectPathForCreateError(sourceTemplate ? sourceTemplate.id : null)}?error=${encodeURIComponent(error.message)}`
        )
      );
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
      return res.redirect(
        appPath(`/templates/${id}?error=${encodeURIComponent('Esta plantilla no se puede editar en su estado actual')}`)
      );
    }

    const category = String(req.body.category || row.category || 'MARKETING').trim().toUpperCase();

    try {
      const { components, placeholderAliases } = await compileBuilderForArea(area, req.body);
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
           meta_id = $1,
           category = $2,
           status = $3,
           components_json = $4::jsonb,
           placeholder_aliases_json = $5::jsonb,
           rejection_reason = NULL,
           submitted_at = NOW(),
           synced_at = NOW()
         WHERE id = $6 AND area = $7`,
        [metaId, category, status, JSON.stringify(components), JSON.stringify(placeholderAliases), id, area]
      );
      auditLog(query, {
        req,
        event_type: AuditEvent.TEMPLATE_SYNC,
        message: `Plantilla reenviada a revisión Meta: ${row.name}`,
        meta: {
          area,
          id,
          status,
          has_aliases: hasPlaceholderAliases(placeholderAliases),
        },
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
      Number.isInteger(templateId) && templateId > 0 ? await loadTemplateById(area, templateId) : null;
    const detailSuffix = Number.isInteger(templateId) && templateId > 0 ? `/${templateId}` : '';
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
      `SELECT id, name, language, category, status, components_json, placeholder_aliases_json
       FROM whatsapp_templates
       WHERE id = $1 AND area = $2`,
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
