const config = require('../config');
const { logError } = require('../utils/logger');
const { normalizeArea } = require('../middleware/auth');
const { resolveAppBaseUrl } = require('./shared/routeContext');
const {
  loadMetaAdsList,
  loadMetaAdDetail,
  updateMetaAdDisplayName,
  formatAdPlatformLabel,
  adDisplayLabel,
} = require('../services/metaCtwaAds');

function registerMetaAds(app, ctx) {
  const { query, appPath } = ctx;

  app.get('/anuncios', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const ads = await loadMetaAdsList(query, area);
    res.render('meta-ads-list', {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
      activeNav: 'anuncios',
      pageTitle: 'Anuncios Meta · MALI WhatsApp',
      ads,
      formatAdPlatformLabel,
      adDisplayLabel,
      flash: req.query.flash || null,
    });
  });

  app.get('/anuncios/:id', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const adId = Number(req.params.id);
    if (!Number.isInteger(adId) || adId <= 0) {
      return res.status(404).send('Anuncio no encontrado');
    }
    const detail = await loadMetaAdDetail(query, area, adId);
    if (!detail) {
      return res.status(404).send('Anuncio no encontrado');
    }
    res.render('meta-ad-detail', {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
      activeNav: 'anuncios',
      pageTitle: `Anuncio ${detail.ad.meta_source_id} · MALI WhatsApp`,
      ad: detail.ad,
      leads: detail.leads,
      formatAdPlatformLabel,
      adDisplayLabel,
      flash: req.query.flash || null,
      error: req.query.error || null,
    });
  });

  app.post('/anuncios/:id/nombre', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const adId = Number(req.params.id);
    if (!Number.isInteger(adId) || adId <= 0) {
      return res.redirect(appPath('/anuncios'));
    }
    try {
      await updateMetaAdDisplayName(query, {
        area,
        adId,
        displayName: req.body.display_name,
      });
      res.redirect(appPath(`/anuncios/${adId}?flash=saved`));
    } catch (e) {
      logError(req, 'Error actualizando nombre de anuncio', e);
      res.redirect(appPath(`/anuncios/${adId}?error=save`));
    }
  });
}

module.exports = { registerMetaAds };
