const config = require('../config');

function isProtectedPath(pathname) {
  const p = String(pathname || '').trim();
  const base = String(config.basePath || '').trim();
  const withBase = (route) => (base ? `${base}${route}` : route);

  if (
    p === '/health' ||
    p === withBase('/health') ||
    p === '/webhook' ||
    p === withBase('/webhook') ||
    p === '/login' ||
    p === withBase('/login') ||
    p === '/logout' ||
    p === withBase('/logout')
  ) {
    return false;
  }
  return true;
}

function normalizeArea(area) {
  const a = String(area || '').trim().toLowerCase();
  if (a === 'pam' || a === 'educacion') return a;
  return 'pam';
}

function createResolveSessionUser(appPath) {
  return function resolveSessionUser(req, res, next) {
    if (
      config.requireAuth &&
      req.session &&
      req.session.userId != null &&
      req.session.email == null
    ) {
      req.session.destroy(() => res.redirect(appPath('/login')));
      return;
    }
    if (!config.requireAuth) {
      const devArea = normalizeArea(process.env.DEV_AREA || 'pam');
      req.user = {
        id: 0,
        email: 'dev@mali.pe',
        area: devArea,
        isMaster: false,
      };
      res.locals.currentUser = req.user;
      res.locals.areaLabel = config.AREA_LABELS[req.user.area] || req.user.area;
      res.locals.showAdminNav = false;
      return next();
    }
    if (req.session && req.session.userId != null) {
      req.user = {
        id: req.session.userId,
        email: req.session.email || '',
        area: normalizeArea(req.session.area),
        isMaster: Boolean(req.session.isMaster),
      };
      res.locals.currentUser = req.user;
      res.locals.areaLabel = config.AREA_LABELS[req.user.area] || req.user.area;
      res.locals.showAdminNav = Boolean(req.user.isMaster);
      return next();
    }
    req.user = null;
    res.locals.showAdminNav = false;
    return next();
  };
}

function createRequireMaster() {
  return function requireMaster(req, res, next) {
    if (!config.requireAuth) {
      if (req.accepts('html')) {
        return res
          .status(403)
          .send('Las herramientas de administracion requieren REQUIRE_AUTH=true');
      }
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (req.user && req.user.isMaster) {
      return next();
    }
    if (req.accepts('html')) {
      return res.status(403).send('Acceso solo para usuario master');
    }
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
}

function createRequireSessionLogin(appPath) {
  return function requireSessionLogin(req, res, next) {
    if (!isProtectedPath(req.path)) {
      return next();
    }
    if (!config.requireAuth) {
      return next();
    }
    if (req.user) {
      return next();
    }
    if (req.accepts('html')) {
      return res.redirect(appPath('/login'));
    }
    return res.status(401).json({ ok: false, error: 'No autenticado' });
  };
}

module.exports = {
  isProtectedPath,
  normalizeArea,
  createResolveSessionUser,
  createRequireSessionLogin,
  createRequireMaster,
};
