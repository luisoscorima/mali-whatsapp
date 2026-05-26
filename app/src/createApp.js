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
const { purgeOldAuditLogs } = require('./services/auditLog');

function parseCampaignPayload(payload) {
  if (!payload) return null;
  if (typeof payload === 'string') {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }
  return typeof payload === 'object' ? payload : null;
}

function formatCampaignParamSourceLabel(source) {
  const s = String(source || '').trim();
  if (!s || s === 'static') return '';
  if (s === 'contact.name') return 'Nombre del contacto';
  if (s === 'contact.phone') return 'Telefono del contacto';
  if (s.startsWith('attr.')) {
    const key = s.slice('attr.'.length).trim();
    return key ? `Atributo: ${key}` : 'Atributo';
  }
  return s;
}

function buildCampaignParamSummary(campaign) {
  const payload = parseCampaignPayload(campaign && campaign.campaign_payload);
  if (!payload) return [];

  const staticParams = payload.staticParams && typeof payload.staticParams === 'object'
    ? payload.staticParams
    : {};
  const paramMapping = payload.paramMapping && typeof payload.paramMapping === 'object'
    ? payload.paramMapping
    : {};
  const items = [];

  const headerMediaUrl = String(staticParams.headerMediaUrl || '').trim();
  if (headerMediaUrl) {
    items.push({
      label: 'Cabecera media',
      value: `Valor fijo: ${headerMediaUrl}`,
      kind: 'static',
    });
  }

  function addList(listKey, labelPrefix) {
    const staticList = Array.isArray(staticParams[listKey]) ? staticParams[listKey] : [];
    const sourceList = Array.isArray(paramMapping[listKey]) ? paramMapping[listKey] : [];
    const count = Math.max(staticList.length, sourceList.length);
    for (let i = 0; i < count; i++) {
      const sourceLabel = formatCampaignParamSourceLabel(sourceList[i]);
      if (sourceLabel) {
        items.push({
          label: `${labelPrefix} ${i + 1}`,
          value: sourceLabel,
          kind: 'dynamic',
        });
        continue;
      }
      const fixedValue = String(staticList[i] ?? '').trim();
      if (!fixedValue) continue;
      items.push({
        label: `${labelPrefix} ${i + 1}`,
        value: `Valor fijo: ${fixedValue}`,
        kind: 'static',
      });
    }
  }

  addList('headerParams', 'Cabecera');
  addList('bodyParams', 'Cuerpo');
  addList('buttonParams', 'Boton URL');

  return items;
}

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
      const p = parseCampaignPayload(campaign.campaign_payload);
      if (p && Array.isArray(p.segments) && p.segments.length) {
        return p.segments.join(', ');
      }
      return String(campaign.segment || '');
    };
    res.locals.campaignParamSummary = buildCampaignParamSummary;
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

  const {
    register,
    resumeQueuedCampaigns,
    resumeInterruptedCampaigns,
    promoteDueScheduledCampaigns,
    promoteDueCampaignRetries,
  } = createRegisterRoutes({
    query,
    pool,
    appPath,
  });
  register(app);

  setInterval(() => {
    promoteDueScheduledCampaigns().catch((err) => {
      console.error(JSON.stringify({ level: 'error', message: 'promoteDueScheduledCampaigns', error: String(err?.message || err) }));
    });
    promoteDueCampaignRetries().catch((err) => {
      console.error(JSON.stringify({ level: 'error', message: 'promoteDueCampaignRetries', error: String(err?.message || err) }));
    });
  }, config.CAMPAIGN_SCHEDULE_POLL_MS);

  const auditPurgeMs = 24 * 60 * 60 * 1000;
  setInterval(() => {
    purgeOldAuditLogs(query).catch((err) => {
      console.error(
        JSON.stringify({ level: 'error', message: 'purgeOldAuditLogs', error: String(err?.message || err) })
      );
    });
  }, auditPurgeMs);

  return {
    app,
    resumeQueuedCampaigns,
    resumeInterruptedCampaigns,
    promoteDueScheduledCampaigns,
    promoteDueCampaignRetries,
  };
}

module.exports = { createApp };
