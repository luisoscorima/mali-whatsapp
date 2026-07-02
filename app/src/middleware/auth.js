const config = require('../config');
const {
  fetchAllowedAreasForUser,
  resolveActiveArea,
} = require('../utils/userAreas');

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
  if (config.BUSINESS_AREAS.includes(a)) return a;
  return 'ti';
}

function isValidBusinessArea(area) {
  const a = String(area || '').trim().toLowerCase();
  return config.BUSINESS_AREAS.includes(a);
}

const LOGIN_LOG_SEEN_BUMP_MS = 60 * 1000;

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
          `SELECT area, is_master, can_edit_ai_prompt, can_view_audit_logs, can_view_integration, can_edit_business_hours, can_view_reports FROM users WHERE id = $1`,
          [req.session.userId]
        );
        if (r.rows.length > 0) {
          const row = r.rows[0];
          const primaryArea = normalizeArea(row.area);
          const isMaster = Boolean(row.is_master);
          const allowedAreas = await fetchAllowedAreasForUser(query, {
            userId: req.session.userId,
            primaryArea,
            isMaster,
          });
          const activeArea = resolveActiveArea(req.session.area, primaryArea, allowedAreas);
          req.session.area = activeArea;
          req.session.isMaster = isMaster;
          req.session.canEditAiPrompt = Boolean(row.can_edit_ai_prompt);
          req.session.canViewAuditLogs = Boolean(row.can_view_audit_logs);
          req.session.canViewIntegration = Boolean(row.can_view_integration);
          req.session.canEditBusinessHours = Boolean(row.can_edit_business_hours);
          req.session.canViewReports = Boolean(row.can_view_reports);
          req.session.allowedAreas = allowedAreas;
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
        canViewAuditLogs: false,
        canViewIntegration: false,
        canEditBusinessHours: false,
        canViewReports: false,
      };
      res.locals.currentUser = req.user;
      res.locals.areaLabel = config.AREA_LABELS[req.user.area] || req.user.area;
      res.locals.showAdminNav = false;
      return next();
    }
    if (req.session && req.session.userId != null) {
      const allowedAreas = Array.isArray(req.session.allowedAreas)
        ? req.session.allowedAreas
        : [normalizeArea(req.session.area)];
      req.user = {
        id: req.session.userId,
        email: req.session.email || '',
        area: normalizeArea(req.session.area),
        allowedAreas,
        isMaster: Boolean(req.session.isMaster),
        canEditAiPrompt: Boolean(req.session.canEditAiPrompt),
        canViewAuditLogs: Boolean(req.session.canViewAuditLogs),
        canViewIntegration: Boolean(req.session.canViewIntegration),
        canEditBusinessHours: Boolean(req.session.canEditBusinessHours),
        canViewReports: Boolean(req.session.canViewReports),
      };
      res.locals.currentUser = req.user;
      res.locals.areaLabel = config.AREA_LABELS[req.user.area] || req.user.area;
      res.locals.showAdminNav = Boolean(req.user.isMaster);
      res.locals.showAreaSwitch =
        Boolean(req.user.isMaster) || (Array.isArray(allowedAreas) && allowedAreas.length > 1);
      res.locals.areaSwitchOptions = (req.user.isMaster ? config.BUSINESS_AREAS : allowedAreas).map(
        (slug) => ({
          slug,
          label: config.AREA_LABELS[slug] || slug,
        })
      );
      if (
        config.requireAuth &&
        req.session.loginLogId != null &&
        Date.now() - (req.session._loginLogBumpAt || 0) >= LOGIN_LOG_SEEN_BUMP_MS
      ) {
        req.session._loginLogBumpAt = Date.now();
        query(
          `UPDATE login_logs SET last_seen_at = NOW() WHERE id = $1 AND logged_out_at IS NULL`,
          [req.session.loginLogId]
        ).catch(() => {
          /* no bloquear request */
        });
      }
      return next();
    }
    req.user = null;
    res.locals.showAdminNav = false;
    return next();
  };
}

function createRequireAuditLogsAccess() {
  return function requireAuditLogsAccess(req, res, next) {
    if (!config.requireAuth) {
      if (req.accepts('html')) {
        return res
          .status(403)
          .send('La bitácora de auditoría requiere REQUIRE_AUTH=true');
      }
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (req.user && (req.user.isMaster || req.user.canViewAuditLogs)) {
      return next();
    }
    if (req.accepts('html')) {
      return res.status(403).send('No tienes acceso a la bitácora de auditoría');
    }
    return res.status(403).json({ ok: false, error: 'Forbidden' });
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
  isValidBusinessArea,
  createResolveSessionUser,
  createRequireSessionLogin,
  createRequirePasswordChange,
  createRequireMaster,
  createRequireAuditLogsAccess,
};
