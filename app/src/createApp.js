const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
const { query } = require('./db/pool');
const { pool } = require('./db/pool');
const { createResolveSessionUser, createRequireSessionLogin } = require('./middleware/auth');
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
  app.use(express.json({ limit: '100kb' }));

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

  const appPath = config.appPath;
  const resolveSessionUser = createResolveSessionUser(appPath);
  const requireSessionLogin = createRequireSessionLogin(appPath);

  app.use(resolveSessionUser);
  app.use(requireSessionLogin);
  app.use(globalLimiter);

  const { register, resumeQueuedCampaigns } = createRegisterRoutes({ query, pool, appPath });
  register(app);

  return { app, resumeQueuedCampaigns };
}

module.exports = { createApp };
