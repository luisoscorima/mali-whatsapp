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
    p === withBase('/logout') ||
    p === '/landing' ||
    p === withBase('/landing')
  ) {
    return false;
  }
  return true;
}

function normalizeArea(area) {
  const a = String(area || '').trim().toLowerCase();
  if (a === 'ti' || a === 'pam' || a === 'educacion') return a;
  return 'ti';
}

function createResolveSessionUser(appPath, query) {
  return async function resolveSessionUser(req, res, next) {
    if (
      config.requireAuth &&
      req.session &&
      req.session.userId != null &&
      req.session.email == null
    ) {
      req.session.destroy(() => res.redirect(appPath('/login')));
      return;
    }

    if (config.requireAuth && req.session && req.session.userId != null) {
      try {
        const r = await query(
          `SELECT area, is_master, can_edit_ai_prompt FROM users WHERE id = $1`,
          [req.session.userId]
        );
        if (r.rows.length > 0) {
          req.session.area = normalizeArea(r.rows[0].area);
          req.session.isMaster = Boolean(r.rows[0].is_master);
          req.session.canEditAiPrompt = Boolean(r.rows[0].can_edit_ai_prompt);
        }
      } catch {
        /* */
      }
    }

    if (!config.requireAuth) {
      const devArea = normalizeArea(process.env.DEV_AREA || 'ti');
      req.user = {
        id: 0,
        email: 'dev@mali.pe',
        area: devArea,
        isMaster: false,
        canEditAiPrompt: false,
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
        canEditAiPrompt: Boolean(req.session.canEditAiPrompt),
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

/** Bloquea el panel hasta cambiar contraseña (sesión con mustChangePassword). */
function createRequirePasswordChange(appPath) {
  function routePath(req) {
    let p = String(req.path || '/');
    const base = String(config.basePath || '').trim();
    if (base && p.startsWith(base)) {
      p = p.slice(base.length) || '/';
    }
    if (!p.startsWith('/')) p = `/${p}`;
    return p;
  }

  function isExempt(p) {
    if (p === '/account/change-password') return true;
    if (p === '/logout') return true;
    return false;
  }

  return function requirePasswordChange(req, res, next) {
    if (!config.requireAuth || !req.user || !req.session.mustChangePassword) {
      return next();
    }
    if (isExempt(routePath(req))) {
      return next();
    }
    if (req.accepts('html')) {
      return res.redirect(302, appPath('/account/change-password'));
    }
    return res.status(403).json({ ok: false, error: 'Debes cambiar tu contraseña' });
  };
}

module.exports = {
  isProtectedPath,
  normalizeArea,
  createResolveSessionUser,
  createRequireSessionLogin,
  createRequirePasswordChange,
  createRequireMaster,
};
