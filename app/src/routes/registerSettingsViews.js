const { createRequireAuditLogsAccess } = require('../middleware/auth');
const { parseAiConfigValue } = require('../utils/aiConfig');
const { parseBusinessHoursConfig, defaultBusinessHoursSeed } = require('../utils/businessHours');
const {
  buildAuditLogWhere,
  auditLogQueryOptsForUser,
  summarizeMetaForAuditRow,
  AUDIT_LEVEL_OPTIONS,
  AUDIT_EVENT_GROUP_OPTIONS,
} = require('../utils/auditLogQuery');
const { formatExportDate } = require('../utils/datetimeDisplay');
const {
  userCanAccessSettingsModule,
  visibleSettingsModules,
  firstSettingsModulePath,
} = require('../utils/settingsModules');
const { fetchContactCommunicationReport } = require('../services/contactCommunicationReport');
const {
  buildContactCommunicationXlsxBuffer,
  contactCommunicationExportFilename,
} = require('../utils/contactCommunicationExport');
const { buildAuditLogXlsxBuffer, auditLogExportFilename } = require('../utils/auditLogExport');

const REPORT_PAGE_SIZE = 50;

function settingsLocals(req, res, commonLocals, extra) {
  return {
    ...commonLocals(req, res),
    activeNav: 'settings',
    settingsModules: visibleSettingsModules(req.user),
    ...extra,
  };
}

function requireSettingsModule(moduleId) {
  return function guard(req, res, next) {
    if (userCanAccessSettingsModule(req.user, moduleId)) {
      return next();
    }
    if (req.accepts('html')) {
      return res.status(403).send('No tienes acceso a este módulo de ajustes');
    }
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
}

function registerSettingsViews(app, ctx) {
  const { query, config, resolveAppBaseUrl, appPath } = ctx;
  const requireAuditLogsAccess = createRequireAuditLogsAccess();

  function commonLocals(req, res) {
    return {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
    };
  }

  app.get('/settings', (req, res) => {
    const first = firstSettingsModulePath(req.user);
    if (!first) {
      return res.render('settings-empty', {
        ...settingsLocals(req, res, commonLocals, {
          pageTitle: 'Ajustes · MALI WhatsApp',
        }),
      });
    }
    res.redirect(appPath(first));
  });

  app.get('/settings/integracion', requireSettingsModule('integracion'), (req, res) => {
    res.render('settings-section', {
      ...settingsLocals(req, res, commonLocals, {
        pageTitle: 'Integración · Ajustes',
        settingsSection: 'integracion',
        settingsHeading: 'Integración',
      }),
    });
  });

  app.get('/settings/ia', requireSettingsModule('ia'), async (req, res) => {
    const u = req.user;
    let aiAreaEnabled = false;
    let aiPrompt = '';
    let aiTransferKeyword = '[TRANSFERIR]';
    if (u) {
      const aiRow = await query(`SELECT value FROM app_settings WHERE area = $1 AND key = 'ai_config'`, [
        u.area,
      ]);
      const cfg = parseAiConfigValue(aiRow.rows[0]?.value);
      aiAreaEnabled = Boolean(cfg && cfg.enabled);
      if (cfg) {
        aiPrompt = cfg.prompt || '';
        aiTransferKeyword = cfg.transfer_keyword || '[TRANSFERIR]';
      }
    }
    res.render('settings-section', {
      ...settingsLocals(req, res, commonLocals, {
        pageTitle: 'Respuesta automática (IA) · Ajustes',
        settingsSection: 'ia',
        settingsHeading: 'Respuesta automática (IA)',
        settingsShowAiMaster: Boolean(u && u.isMaster),
        aiAreaEnabled,
        masterArea: u && u.area ? u.area : '',
        aiPrompt,
        aiTransferKeyword,
      }),
    });
  });

  app.get('/settings/fuera-de-horario', requireSettingsModule('fuera-de-horario'), async (req, res) => {
    const u = req.user;
    const bhDefaults = defaultBusinessHoursSeed();
    let businessHoursEnabled = bhDefaults.enabled;
    let businessHoursDays = bhDefaults.days;
    let businessHoursFrom = bhDefaults.from;
    let businessHoursTo = bhDefaults.to;
    let businessHoursMessage = bhDefaults.outside_hours_message;
    let businessHoursTimezone = bhDefaults.timezone;
    if (u) {
      const bhRow = await query(`SELECT value FROM app_settings WHERE area = $1 AND key = 'business_hours'`, [
        u.area,
      ]);
      const bhCfg = parseBusinessHoursConfig(bhRow.rows[0]?.value);
      if (bhCfg) {
        businessHoursEnabled = bhCfg.enabled;
        businessHoursDays = bhCfg.days.length ? bhCfg.days : bhDefaults.days;
        businessHoursFrom = bhCfg.from || bhDefaults.from;
        businessHoursTo = bhCfg.to || bhDefaults.to;
        businessHoursMessage = bhCfg.outside_hours_message || '';
        businessHoursTimezone = bhCfg.timezone || bhDefaults.timezone;
      }
    }
    res.render('settings-section', {
      ...settingsLocals(req, res, commonLocals, {
        pageTitle: 'Fuera de horario · Ajustes',
        settingsSection: 'fuera-de-horario',
        settingsHeading: 'Fuera de horario',
        masterArea: u && u.area ? u.area : '',
        businessHoursEnabled,
        businessHoursDays,
        businessHoursFrom,
        businessHoursTo,
        businessHoursMessage,
        businessHoursTimezone,
      }),
    });
  });

  app.get('/settings/bitacora/export.xlsx', requireAuditLogsAccess, requireSettingsModule('bitacora'), async (req, res) => {
    const auditOpts = auditLogQueryOptsForUser(req.user);
    const { whereSql, params } = buildAuditLogWhere(req.query, auditOpts);
    const maxRows = 25000;
    const exportParams = [...params, maxRows];
    const limIdx = params.length + 1;
    const r = await query(
      `SELECT created_at, level, event_type, message, actor_user_id, actor_email, area, client_ip, request_id, meta
       FROM audit_logs ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limIdx}`,
      exportParams
    );

    const buf = buildAuditLogXlsxBuffer(r.rows);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${auditLogExportFilename('bitacora-ajustes')}"`
    );
    res.send(buf);
  });

  app.get('/settings/bitacora', requireAuditLogsAccess, requireSettingsModule('bitacora'), async (req, res) => {
    const auditOpts = auditLogQueryOptsForUser(req.user);
    const { whereSql, params, filters } = buildAuditLogWhere(req.query, auditOpts);
    const areaScope = auditOpts.areaScope;
    const { level, event, from, to } = filters;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = 50;

    const exportSp = new URLSearchParams();
    if (level) exportSp.set('level', level);
    if (event) exportSp.set('event', event);
    if (from) exportSp.set('from', from);
    if (to) exportSp.set('to', to);
    const exportQs = exportSp.toString();
    const auditExportHref = `${appPath('/settings/bitacora/export.xlsx')}${exportQs ? `?${exportQs}` : ''}`;

    const countR = await query(`SELECT COUNT(*)::int AS c FROM audit_logs ${whereSql}`, params);
    const total = Number(countR.rows[0]?.c || 0);
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const pageClamped = Math.min(page, totalPages);

    const offsetUse = (pageClamped - 1) * pageSize;
    const listParams = [...params, pageSize, offsetUse];
    const limIdx = params.length + 1;
    const offIdx = params.length + 2;
    const r = await query(
      `SELECT id, created_at, level, event_type, message, actor_user_id, actor_email, area, client_ip, request_id, meta
       FROM audit_logs ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT $${limIdx} OFFSET $${offIdx}`,
      listParams
    );

    const rows = r.rows.map((row) => ({
      ...row,
      createdDisplay: formatExportDate(row.created_at) || '—',
      metaSummary: summarizeMetaForAuditRow(row.meta),
    }));

    function auditQueryString(overrides) {
      const sp = new URLSearchParams();
      const base = {
        level: level || '',
        event: event || '',
        from: from || '',
        to: to || '',
        page: String(pageClamped),
        ...overrides,
      };
      if (base.level) sp.set('level', base.level);
      if (base.event) sp.set('event', base.event);
      if (base.from) sp.set('from', base.from);
      if (base.to) sp.set('to', base.to);
      if (base.page && base.page !== '1') sp.set('page', base.page);
      const s = sp.toString();
      return s ? `?${s}` : '';
    }

    res.render('settings-section', {
      ...settingsLocals(req, res, commonLocals, {
        pageTitle: 'Bitácora · Ajustes',
        settingsSection: 'bitacora',
        settingsHeading: 'Bitácora de auditoría',
        auditRows: rows,
        auditFilters: { level, event, from, to },
        auditLevelOptions: AUDIT_LEVEL_OPTIONS,
        auditEventGroupOptions: AUDIT_EVENT_GROUP_OPTIONS,
        auditPagination: {
          page: pageClamped,
          totalPages,
          total,
          prev: pageClamped > 1 ? auditQueryString({ page: String(pageClamped - 1) }) : null,
          next: pageClamped < totalPages ? auditQueryString({ page: String(pageClamped + 1) }) : null,
        },
        displayTimezone: config.DISPLAY_TIMEZONE,
        auditRetentionDays: config.AUDIT_LOG_RETENTION_DAYS,
        auditExportHref,
        auditAreaScoped: Boolean(areaScope),
        auditAreaLabel: areaScope ? config.AREA_LABELS[areaScope] || areaScope : null,
      }),
    });
  });

  app.get(
    '/settings/reporteria/export.xlsx',
    requireSettingsModule('reporteria'),
    async (req, res) => {
      const area = req.user?.area;
      if (!area) return res.status(400).send('Área no disponible');
      const { rows } = await fetchContactCommunicationReport(query, area, {});
      const buf = buildContactCommunicationXlsxBuffer(rows);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${contactCommunicationExportFilename(area)}"`
      );
      res.send(buf);
    }
  );

  app.get('/settings/reporteria', requireSettingsModule('reporteria'), async (req, res) => {
    const area = req.user?.area;
    if (!area) return res.status(400).send('Área no disponible');
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const { total, rows } = await fetchContactCommunicationReport(query, area, {
      limit: REPORT_PAGE_SIZE,
      offset: (page - 1) * REPORT_PAGE_SIZE,
    });
    const totalPages = Math.max(1, Math.ceil(total / REPORT_PAGE_SIZE));
    const pageClamped = Math.min(page, totalPages);

    res.render('settings-section', {
      ...settingsLocals(req, res, commonLocals, {
        pageTitle: 'Reportería · Ajustes',
        settingsSection: 'reporteria',
        settingsHeading: 'Reportería',
        reportRows: rows,
        reportPagination: {
          page: pageClamped,
          totalPages,
          total,
          prev: pageClamped > 1 ? `?page=${pageClamped - 1}` : null,
          next: pageClamped < totalPages ? `?page=${pageClamped + 1}` : null,
        },
        reportExportHref: appPath('/settings/reporteria/export.xlsx'),
        reportAreaLabel: config.AREA_LABELS[area] || area,
      }),
    });
  });
}

module.exports = { registerSettingsViews };
