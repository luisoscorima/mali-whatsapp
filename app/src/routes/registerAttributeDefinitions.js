const { logError } = require('../utils/logger');
const { auditLog, AuditEvent } = require('../services/auditLog');
const { normalizeArea } = require('../middleware/auth');
const { resolveAppBaseUrl } = require('./shared/routeContext');
const config = require('../config');
const { ALLOWED_ATTR_KEYS } = require('../services/contactAttributes');
const {
  normalizeAttrSlug,
  normalizeFieldType,
  loadAttributeDefinitionsForArea,
  loadAttributeDefinitionById,
} = require('../services/contactAttributeDefinitions');

function registerAttributeDefinitions(app, ctx) {
  const { query, appPath, loadSegments, getSegmentSlugSet } = ctx;

  function renderAttributesPage(req, res, opts) {
    const {
      view,
      definitions,
      segments,
      selectedDefinition = null,
      flash,
      error,
      prefillScope = 'area',
      prefillSegment = '',
    } = opts;
    res.render('attributes-page', {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
      activeNav: 'attributes',
      pageTitle:
        view === 'new'
          ? 'Nuevo atributo · MALI'
          : view === 'detail' && selectedDefinition
            ? `${selectedDefinition.label} · Atributos`
            : 'Atributos de contacto · MALI',
      view,
      definitions,
      segments,
      selectedDefinitionId: selectedDefinition ? selectedDefinition.id : null,
      selectedDefinition,
      flash: flash || null,
      error: error || null,
      prefillScope,
      prefillSegment,
    });
  }

  app.get('/attributes', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const [definitions, segments] = await Promise.all([
      loadAttributeDefinitionsForArea(query, area),
      loadSegments(area),
    ]);
    renderAttributesPage(req, res, {
      view: 'list',
      definitions,
      segments,
      flash: req.query.flash || null,
    });
  });

  app.get('/attributes/new', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const [definitions, segments] = await Promise.all([
      loadAttributeDefinitionsForArea(query, area),
      loadSegments(area),
    ]);
    renderAttributesPage(req, res, {
      view: 'new',
      definitions,
      segments,
      error: req.query.error || null,
      prefillScope: req.query.scope === 'segment' ? 'segment' : 'area',
      prefillSegment: String(req.query.segment || '').trim(),
    });
  });

  app.get('/attributes/:id', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(404).send('Atributo no encontrado');
    }
    const [definitions, segments, selectedDefinition] = await Promise.all([
      loadAttributeDefinitionsForArea(query, area),
      loadSegments(area),
      loadAttributeDefinitionById(query, area, id),
    ]);
    if (!selectedDefinition) {
      return res.status(404).send('Atributo no encontrado');
    }
    renderAttributesPage(req, res, {
      view: 'detail',
      definitions,
      segments,
      selectedDefinition,
      flash: req.query.flash || null,
      error: req.query.error || null,
    });
  });

  app.post('/attributes', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const segmentSet = await getSegmentSlugSet(area);
    const scope = String(req.body.scope || 'area').trim();
    const segmentSlug =
      scope === 'segment' ? String(req.body.segment_slug || '').trim() : null;
    const slug = normalizeAttrSlug(req.body.slug);
    const label = String(req.body.label || '').trim().slice(0, 120);
    const fieldType = normalizeFieldType(req.body.field_type);
    let sortOrder = parseInt(String(req.body.sort_order || '0').trim(), 10);
    const required = String(req.body.required || '') === '1';
    if (Number.isNaN(sortOrder)) sortOrder = 0;

    if (!ALLOWED_ATTR_KEYS.test(slug)) {
      return res.redirect(appPath('/attributes/new?error=slug'));
    }
    if (!label) {
      return res.redirect(appPath('/attributes/new?error=label'));
    }
    if (segmentSlug && !segmentSet.has(segmentSlug)) {
      return res.redirect(appPath('/attributes/new?error=segment'));
    }

    try {
      await query(
        `INSERT INTO contact_attribute_definitions
           (area, segment_slug, slug, label, field_type, sort_order, required, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)`,
        [area, segmentSlug, slug, label, fieldType, sortOrder, required]
      );
      auditLog(query, {
        req,
        event_type: AuditEvent.CONTACT_UPDATED,
        message: `Definición de atributo creada: ${slug} (${area})`,
        meta: { area, slug, segment_slug: segmentSlug },
      });
      res.redirect(appPath('/attributes?flash=created'));
    } catch (error) {
      if (error.code === '23505') {
        return res.redirect(appPath('/attributes/new?error=duplicate'));
      }
      logError(req, 'Error creando definición de atributo', error);
      res.redirect(appPath('/attributes/new?error=save'));
    }
  });

  app.post('/attributes/:id/update', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send('Id inválido');
    }
    const existing = await loadAttributeDefinitionById(query, area, id);
    if (!existing) {
      return res.status(404).send('Atributo no encontrado');
    }

    const label = String(req.body.label || '').trim().slice(0, 120);
    const fieldType = normalizeFieldType(req.body.field_type);
    let sortOrder = parseInt(String(req.body.sort_order || '0').trim(), 10);
    const required = String(req.body.required || '') === '1';
    const active = String(req.body.active || '1') === '1';
    if (Number.isNaN(sortOrder)) sortOrder = 0;
    if (!label) {
      return res.redirect(appPath(`/attributes/${id}?error=label`));
    }

    try {
      await query(
        `UPDATE contact_attribute_definitions SET
           label = $1, field_type = $2, sort_order = $3, required = $4, active = $5, updated_at = NOW()
         WHERE id = $6 AND area = $7`,
        [label, fieldType, sortOrder, required, active, id, area]
      );
      res.redirect(appPath(`/attributes/${id}?flash=updated`));
    } catch (error) {
      logError(req, 'Error actualizando definición de atributo', error);
      res.redirect(appPath(`/attributes/${id}?error=save`));
    }
  });

  app.post('/attributes/:id/delete', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).send('Id inválido');
    }
    await query(`DELETE FROM contact_attribute_definitions WHERE id = $1 AND area = $2`, [id, area]);
    res.redirect(appPath('/attributes?flash=deleted'));
  });

  app.get('/api/attribute-definitions/options', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const rows = await loadAttributeDefinitionsForArea(query, area);
    const segmentLabels = new Map();
    const segments = await loadSegments(area);
    for (const s of segments) {
      segmentLabels.set(s.value, s.label);
    }
    const options = [
      { value: 'static', label: 'Valor fijo (campo de arriba)' },
      { value: 'contact.name', label: 'Nombre del contacto' },
      { value: 'contact.phone', label: 'Teléfono del contacto' },
      ...rows.map((r) => {
        const seg = r.segment_slug
          ? ` · ${segmentLabels.get(r.segment_slug) || r.segment_slug}`
          : '';
        return {
          value: `attr.${r.slug}`,
          label: `Atributo: ${r.label}${seg}`,
        };
      }),
    ];
    res.json({ ok: true, options });
  });
}

module.exports = { registerAttributeDefinitions };
