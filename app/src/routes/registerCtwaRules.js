const config = require('../config');
const { logError } = require('../utils/logger');
const { normalizeArea } = require('../middleware/auth');
const { resolveAppBaseUrl } = require('./shared/routeContext');

function registerCtwaRules(app, ctx) {
  const { query, appPath, getSegmentSlugSet } = ctx;

  app.get('/ctwa-rules', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const [rulesR, segments] = await Promise.all([
      query(
        `SELECT id, meta_source_id, headline_pattern, segment_slug, tag_label, active, created_at
         FROM ctwa_tag_rules WHERE area = $1 ORDER BY id DESC`,
        [area]
      ),
      query(
        `SELECT slug, label FROM segment_definitions WHERE area = $1 ORDER BY sort_order, slug`,
        [area]
      ),
    ]);
    res.render('ctwa-rules-page', {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
      activeNav: 'ctwa-rules',
      pageTitle: 'Reglas CTWA (anuncios) · MALI WhatsApp',
      rules: rulesR.rows,
      segments: segments.rows,
      flash: req.query.flash || null,
    });
  });

  app.post('/ctwa-rules', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const segmentSet = await getSegmentSlugSet(area);
    const metaSourceId = String(req.body.meta_source_id || '').trim() || null;
    const headlinePattern = String(req.body.headline_pattern || '').trim() || null;
    const segmentSlug = String(req.body.segment_slug || '').trim();
    const tagLabel = String(req.body.tag_label || '').trim().slice(0, 120);

    if (!metaSourceId && !headlinePattern) {
      return res.redirect(appPath('/ctwa-rules?error=match'));
    }
    if (!segmentSet.has(segmentSlug)) {
      return res.redirect(appPath('/ctwa-rules?error=segment'));
    }
    if (!tagLabel) {
      return res.redirect(appPath('/ctwa-rules?error=label'));
    }

    try {
      await query(
        `INSERT INTO ctwa_tag_rules (area, meta_source_id, headline_pattern, segment_slug, tag_label, active)
         VALUES ($1, $2, $3, $4, $5, TRUE)`,
        [area, metaSourceId, headlinePattern, segmentSlug, tagLabel]
      );
      res.redirect(appPath('/ctwa-rules?flash=created'));
    } catch (e) {
      logError(req, 'Error creando regla CTWA', e);
      res.redirect(appPath('/ctwa-rules?error=save'));
    }
  });

  app.post('/ctwa-rules/:id/toggle', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const id = Number(req.params.id);
    await query(
      `UPDATE ctwa_tag_rules SET active = NOT active WHERE id = $1 AND area = $2`,
      [id, area]
    );
    res.redirect(appPath('/ctwa-rules'));
  });

  app.post('/ctwa-rules/:id/delete', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const id = Number(req.params.id);
    await query(`DELETE FROM ctwa_tag_rules WHERE id = $1 AND area = $2`, [id, area]);
    res.redirect(appPath('/ctwa-rules?flash=deleted'));
  });
}

module.exports = { registerCtwaRules };
