const fs = require('fs');
const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const config = require('./config');
const datetimeDisplay = require('./utils/datetimeDisplay');
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
      limit: config.CAMPAIGN_JSON_BODY_LIMIT || '2mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );

  app.use((req, res, next) => {
    res.locals.basePath = config.basePath;
    res.locals.displayTimezone = datetimeDisplay.DISPLAY_TIMEZONE;
    res.locals.formatChatListTime = datetimeDisplay.formatChatListTime;
    res.locals.formatMessageDateTime = datetimeDisplay.formatMessageDateTime;
    res.locals.formatExportDate = datetimeDisplay.formatExportDate;
    res.locals.campaignSegmentDisplay = function campaignSegmentDisplay(campaign) {
      if (!campaign) return '';
      let p = campaign.campaign_payload;
      if (typeof p === 'string') {
        try {
          p = JSON.parse(p);
        } catch {
          p = null;
        }
      }
      if (p && Array.isArray(p.segments) && p.segments.length) {
        return p.segments.join(', ');
      }
      return String(campaign.segment || '');
    };
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

  const emojiPickerPath = path.join(__dirname, '..', 'node_modules', 'emoji-picker-element');
  if (fs.existsSync(emojiPickerPath)) {
    app.use('/vendor/emoji-picker-element', express.static(emojiPickerPath));
    if (config.basePath) {
      app.use(`${config.basePath}/vendor/emoji-picker-element`, express.static(emojiPickerPath));
    }
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

  const { register, resumeQueuedCampaigns, promoteDueScheduledCampaigns } = createRegisterRoutes({
    query,
    pool,
    appPath,
  });
  register(app);

  setInterval(() => {
    promoteDueScheduledCampaigns().catch((err) => {
      console.error(JSON.stringify({ level: 'error', message: 'promoteDueScheduledCampaigns', error: String(err?.message || err) }));
    });
  }, config.CAMPAIGN_SCHEDULE_POLL_MS);

  return { app, resumeQueuedCampaigns, promoteDueScheduledCampaigns };
}

module.exports = { createApp };
