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
        'SELECT id, email, password_hash, area, is_master FROM users WHERE email = $1',
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
      req.session.userId = user.id;
      req.session.email = user.email;
      req.session.area = user.area;
      req.session.isMaster = Boolean(user.is_master);
      res.redirect(appPath('/campaigns'));
    } catch (err) {
      logError(req, 'Error en login', err);
      res.status(500).render('login', { error: 'Error interno. Intenta de nuevo.', basePath: config.basePath });
    }
  });

  app.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.redirect(appPath('/login'));
    });
  });
}

module.exports = { registerAuth };
