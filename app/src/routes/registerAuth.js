const bcrypt = require('bcryptjs');
const { logError } = require('../utils/logger');
const { isValidMaliEmail, normalizeEmail } = require('../utils/contactsCsv');

function registerAuth(app, ctx) {
  const { config, query, appPath } = ctx;

  app.get('/login', (req, res) => {
    if (config.requireAuth && req.user) {
      return res.redirect(appPath('/campaigns'));
    }
    if (!config.requireAuth) {
      return res.redirect(appPath('/campaigns'));
    }
    res.render('login', { error: null, basePath: config.basePath });
  });

  app.post('/login', async (req, res) => {
    if (!config.requireAuth) {
      return res.redirect(appPath('/campaigns'));
    }
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    if (!email || !password) {
      return res.status(400).render('login', { error: 'Correo y contraseña son obligatorios', basePath: config.basePath });
    }
    if (!isValidMaliEmail(email)) {
      return res.status(400).render('login', {
        error: 'Usa un correo @mali.pe',
        basePath: config.basePath,
      });
    }
    try {
      const result = await query(
        'SELECT id, email, password_hash, area, is_master, must_change_password FROM users WHERE email = $1',
        [email]
      );
      if (result.rowCount === 0) {
        return res.status(401).render('login', { error: 'Credenciales incorrectas', basePath: config.basePath });
      }
      const user = result.rows[0];
      const ok = await bcrypt.compare(password, user.password_hash);
      if (!ok) {
        return res.status(401).render('login', { error: 'Credenciales incorrectas', basePath: config.basePath });
      }
      let loginLogId = null;
      try {
        const ins = await query(
          `INSERT INTO login_logs (user_id, email, last_seen_at) VALUES ($1, $2, NOW()) RETURNING id`,
          [user.id, user.email]
        );
        loginLogId = ins.rows[0]?.id ?? null;
      } catch (logErr) {
        logError(req, 'Error registrando inicio de sesion', logErr);
      }
      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.area = user.area;
      req.session.isMaster = Boolean(user.is_master);
      req.session.mustChangePassword = Boolean(user.must_change_password);
      if (loginLogId != null) {
        req.session.loginLogId = loginLogId;
      }
      if (req.session.mustChangePassword) {
        return res.redirect(appPath('/account/change-password'));
      }
      res.redirect(appPath('/campaigns'));
    } catch (err) {
      logError(req, 'Error en login', err);
      res.status(500).render('login', { error: 'Error interno. Intenta de nuevo.', basePath: config.basePath });
    }
  });

  app.post('/logout', (req, res) => {
    const logId = req.session && req.session.loginLogId != null ? req.session.loginLogId : null;
    const finish = () => {
      req.session.destroy((destroyErr) => {
        if (destroyErr) {
          logError(req, 'Error destruyendo sesion', destroyErr);
        }
        res.redirect(appPath('/login'));
      });
    };
    if (logId == null) {
      return finish();
    }
    query(
      `UPDATE login_logs SET logged_out_at = NOW() WHERE id = $1 AND logged_out_at IS NULL`,
      [logId]
    )
      .catch((e) => logError(req, 'Error registrando cierre de sesion', e))
      .finally(() => finish());
  });

  app.get('/account/change-password', (req, res) => {
    if (!config.requireAuth || !req.user) {
      return res.redirect(appPath('/login'));
    }
    if (!req.session.mustChangePassword) {
      return res.redirect(appPath('/campaigns'));
    }
    res.render('account-change-password', {
      basePath: config.basePath,
      error: null,
    });
  });

  app.post('/account/change-password', async (req, res) => {
    if (!config.requireAuth || !req.user) {
      return res.redirect(appPath('/login'));
    }
    if (!req.session.mustChangePassword) {
      return res.redirect(appPath('/campaigns'));
    }
    const currentPassword = String(req.body.current_password || '');
    const newPassword = String(req.body.new_password || '');
    const confirm = String(req.body.confirm_password || '');
    const renderErr = (msg) =>
      res.status(400).render('account-change-password', { basePath: config.basePath, error: msg });

    if (!currentPassword || !newPassword || !confirm) {
      return renderErr('Completa todos los campos');
    }
    if (newPassword.length < 6) {
      return renderErr('La nueva contraseña debe tener al menos 6 caracteres');
    }
    if (newPassword !== confirm) {
      return renderErr('La nueva contraseña y la confirmación no coinciden');
    }
    if (newPassword === currentPassword) {
      return renderErr('La nueva contraseña debe ser distinta a la actual');
    }

    try {
      const r = await query(`SELECT password_hash FROM users WHERE id = $1`, [req.session.userId]);
      if (r.rowCount === 0) {
        return res.redirect(appPath('/login'));
      }
      const ok = await bcrypt.compare(currentPassword, r.rows[0].password_hash);
      if (!ok) {
        return renderErr('La contraseña actual no es correcta');
      }
      const hash = await bcrypt.hash(newPassword, 10);
      await query(
        `UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2`,
        [hash, req.session.userId]
      );
      req.session.mustChangePassword = false;
      res.redirect(appPath('/campaigns'));
    } catch (err) {
      logError(req, 'Error cambiando contraseña', err);
      res.status(500).render('account-change-password', {
        basePath: config.basePath,
        error: 'Error interno. Intenta de nuevo.',
      });
    }
  });
}

module.exports = { registerAuth };
