const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
const { query } = require('./db/pool');
const { pool } = require('./db/pool');
const {
  createResolveSessionUser,
  createRequireSessionLogin,
  createRequirePasswordChange,
} = require('./middleware/auth');
const { globalLimiter } = require('./middleware/limiters');
const { createRegisterRoutes } = require('./routes/registerRoutes');

function createApp() {
  const app = express();
  app.set('trust proxy', 1);

  const viewsPath = path.join(__dirname, '..', 'views');
  app.set('view engine', 'ejs');
  app.set('views', viewsPath);

  app.use(
    helmet({
      contentSecurityPolicy: false,
    })
  );
  app.use(express.urlencoded({ extended: true, limit: '100kb' }));
  // Meta firma el cuerpo RAW del POST; guardamos el buffer para X-Hub-Signature-256 (ver webhookVerify.js).
  app.use(
    express.json({
      limit: '100kb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  app.use((req, res, next) => {
    res.locals.basePath = config.basePath;
    next();
  });

  if (config.requireAuth && !config.sessionSecret && config.isProduction) {
    console.error('Falta SESSION_SECRET con REQUIRE_AUTH en produccion');
    process.exit(1);
  }

  app.use(
    session({
      name: 'mali.sid',
      secret: config.sessionSecret || 'dev-session-secret-cambiar',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: config.isProduction,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: config.basePath || '/',
      },
    })
  );

  const publicPath = path.join(__dirname, '..', 'public');
  app.use(express.static(publicPath));
  // Las vistas usan basePath + '/css/...', '/uploads/...', etc. Si BASE_PATH está definido,
  // el navegador pide /{basePath}/uploads/...; hay que servir public también bajo ese prefijo.
  if (config.basePath) {
    app.use(config.basePath, express.static(publicPath));
  }

  const appPath = config.appPath;
  const resolveSessionUser = createResolveSessionUser(appPath, query);
  const requireSessionLogin = createRequireSessionLogin(appPath);
  const requirePasswordChange = createRequirePasswordChange(appPath);

  app.use((req, res, next) => {
    Promise.resolve(resolveSessionUser(req, res, next)).catch(next);
  });
  app.use(requireSessionLogin);
  app.use(requirePasswordChange);
  app.use(globalLimiter);

  const { register, resumeQueuedCampaigns } = createRegisterRoutes({ query, pool, appPath });
  register(app);

  return { app, resumeQueuedCampaigns };
}

module.exports = { createApp };
