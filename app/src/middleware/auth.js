const config = require('../config');

function isProtectedPath(pathname) {
  if (
    pathname === '/health' ||
    pathname === '/webhook' ||
    pathname === '/login' ||
    pathname === '/logout'
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
      return next();
    }
    req.user = null;
    return next();
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
};
