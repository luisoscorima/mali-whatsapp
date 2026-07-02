const multer = require('multer');
const bcrypt = require('bcryptjs');
const { normalizeArea, isValidBusinessArea, createRequireMaster } = require('../middleware/auth');
const {
  buildAuditLogWhere,
  summarizeMetaForAuditRow,
  AUDIT_LEVEL_OPTIONS,
  AUDIT_EVENT_GROUP_OPTIONS,
} = require('../utils/auditLogQuery');
const { buildAuditLogXlsxBuffer, auditLogExportFilename } = require('../utils/auditLogExport');
const { isValidMaliEmail, normalizeEmail } = require('../utils/contactsCsv');
const { parseUsersBulkCsvBuffer, parseUsersBulkXlsxBuffer } = require('../utils/usersBulkCsv');
const { usersBulkImportLimiter, usersBulkImportUpload } = require('../middleware/limiters');
const { refreshMetaSettingsCache, KEYS } = require('../services/metaSettingsCache');
const { formatExportDate } = require('../utils/datetimeDisplay');
const { auditLog, AuditEvent } = require('../services/auditLog');
const {
  parseExtraAreasFromBody,
  fetchExtraAreasForUser,
  replaceExtraAreasForUser,
} = require('../utils/userAreas');

function adminLocals(req, res, ctx, extra) {
  const { config, resolveAppBaseUrl, appPath } = ctx;
  return {
    basePath: config.basePath,
    requireAuth: config.requireAuth,
    currentUser: req.user,
    areaLabel: res.locals.areaLabel,
    appBaseUrl: resolveAppBaseUrl(),
    showAdminNav: res.locals.showAdminNav,
    areaDefs: config.BUSINESS_AREAS.map((slug) => ({
      slug,
      label: config.AREA_LABELS[slug] || slug,
    })),
    ...extra,
  };
}

function parseQueryInt(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCheckbox(body, name) {
  return String(body[name] || '') === '1' || body[name] === 'on';
}

function parseUserSettingsPerms(body) {
  return {
    canViewIntegration: parseCheckbox(body, 'can_view_integration'),
    canEditAiPrompt: parseCheckbox(body, 'can_edit_ai_prompt'),
    canEditBusinessHours: parseCheckbox(body, 'can_edit_business_hours'),
    canViewAuditLogs: parseCheckbox(body, 'can_view_audit_logs'),
    canViewReports: parseCheckbox(body, 'can_view_reports'),
  };
}

function userRowWithPerms(row, perms) {
  return {
    ...row,
    can_view_integration: perms.canViewIntegration,
    can_edit_ai_prompt: perms.canEditAiPrompt,
    can_edit_business_hours: perms.canEditBusinessHours,
    can_view_audit_logs: perms.canViewAuditLogs,
    can_view_reports: perms.canViewReports,
  };
}

const USER_SETTINGS_PERM_COLS =
  'can_edit_ai_prompt, can_view_audit_logs, can_view_integration, can_edit_business_hours, can_view_reports';

/** Misma ventana que “en línea” en login_logs (coherente con middleware de last_seen). */
const ONLINE_USER_IDLE_MINUTES = 5;

function metaAuditNonEmptyKeys(body) {
  const b = body || {};
  const keys = [];
  if (String(b.verify_token || '').trim()) keys.push('verify_token');
  if (String(b.app_secret || '').trim()) keys.push('app_secret');
  if (String(b.ti_whatsapp_token || '').trim()) keys.push('ti_whatsapp_token');
  if (String(b.ti_phone_number_id || '').trim()) keys.push('ti_phone_number_id');
  if (String(b.ti_waba_id || '').trim()) keys.push('ti_waba_id');
  if (String(b.pam_whatsapp_token || '').trim()) keys.push('pam_whatsapp_token');
  if (String(b.pam_phone_number_id || '').trim()) keys.push('pam_phone_number_id');
  if (String(b.pam_waba_id || '').trim()) keys.push('pam_waba_id');
  if (String(b.patronato_whatsapp_token || '').trim()) keys.push('patronato_whatsapp_token');
  if (String(b.patronato_phone_number_id || '').trim()) keys.push('patronato_phone_number_id');
  if (String(b.patronato_waba_id || '').trim()) keys.push('patronato_waba_id');
  if (String(b.edu_whatsapp_token || '').trim()) keys.push('edu_whatsapp_token');
  if (String(b.edu_phone_number_id || '').trim()) keys.push('edu_phone_number_id');
  if (String(b.edu_waba_id || '').trim()) keys.push('edu_waba_id');
  if (String(b.edu_ca_whatsapp_token || '').trim()) keys.push('edu_ca_whatsapp_token');
  if (String(b.edu_ca_phone_number_id || '').trim()) keys.push('edu_ca_phone_number_id');
  if (String(b.edu_ca_waba_id || '').trim()) keys.push('edu_ca_waba_id');
  if (String(b.edu_ep_whatsapp_token || '').trim()) keys.push('edu_ep_whatsapp_token');
  if (String(b.edu_ep_phone_number_id || '').trim()) keys.push('edu_ep_phone_number_id');
  if (String(b.edu_ep_waba_id || '').trim()) keys.push('edu_ep_waba_id');
  return keys;
}

async function upsertMetaSetting(query, area, key, rawValue) {
  const v = String(rawValue || '').trim();
  if (!v) {
    await query(`DELETE FROM app_settings WHERE area = $1 AND key = $2`, [area, key]);
  } else {
    await query(
      `INSERT INTO app_settings (area, key, value, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (area, key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [area, key, v]
    );
  }
}

function registerAdmin(app, ctx) {
  const { query, pool, config, resolveAppBaseUrl, appPath } = ctx;
  const requireMaster = createRequireMaster();
  const AREA_DEFS = config.BUSINESS_AREAS.map((slug) => ({
    slug,
    label: config.AREA_LABELS[slug] || slug,
  }));

  app.get('/admin/login-logs', requireMaster, (req, res) => {
    res.redirect(302, appPath('/admin/users-online'));
  });

  app.get('/api/admin/online-users', requireMaster, async (req, res) => {
    try {
      const r = await query(
        `SELECT email
         FROM login_logs
         WHERE logged_out_at IS NULL
           AND COALESCE(last_seen_at, logged_at) >= NOW() - ($1::int * INTERVAL '1 minute')
         GROUP BY email
         ORDER BY email ASC`,
        [ONLINE_USER_IDLE_MINUTES]
      );
      return res.json({ ok: true, users: r.rows.map((row) => ({ email: row.email })) });
    } catch (e) {
      return res.status(500).json({ ok: false, error: e?.message || 'Error' });
    }
  });

  app.get('/admin/users-online', requireMaster, (req, res) => {
    res.render('admin-users-online', {
      ...adminLocals(req, res, ctx, {
        activeNav: 'admin-users-online',
        adminSection: 'users-online',
        onlinePollMs: 20000,
        onlineApiUrl: appPath('/api/admin/online-users'),
        onlineIdleMinutes: ONLINE_USER_IDLE_MINUTES,
      }),
    });
  });

  app.get('/admin/audit-logs/export.xlsx', requireMaster, async (req, res) => {
    const { whereSql, params } = buildAuditLogWhere(req.query);
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
      `attachment; filename="${auditLogExportFilename('bitacora-admin')}"`
    );
    res.send(buf);
  });

  app.get('/admin/audit-logs', requireMaster, async (req, res) => {
    const { whereSql, params, filters } = buildAuditLogWhere(req.query);
    const { level, event, from, to } = filters;
    const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
    const pageSize = 50;

    const exportSp = new URLSearchParams();
    if (level) exportSp.set('level', level);
    if (event) exportSp.set('event', event);
    if (from) exportSp.set('from', from);
    if (to) exportSp.set('to', to);
    const exportQs = exportSp.toString();
    const auditExportHref = `${appPath('/admin/audit-logs/export.xlsx')}${exportQs ? `?${exportQs}` : ''}`;

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

    res.render('admin-audit-logs', {
      ...adminLocals(req, res, ctx, {
        auditRows: rows,
        activeNav: 'admin-audit-logs',
        adminSection: 'audit-logs',
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
        displayTimezone: ctx.config.DISPLAY_TIMEZONE,
        auditRetentionDays: ctx.config.AUDIT_LOG_RETENTION_DAYS,
        auditExportHref,
      }),
    });
  });

  app.get('/admin/users', requireMaster, async (req, res) => {
    const r = await query(
      `SELECT id, email, area, is_master, must_change_password, ${USER_SETTINGS_PERM_COLS}, created_at FROM users ORDER BY email ASC`
    );
    const q = req.query;
    const bulkImport =
      String(q.bulk_import || '') === '1'
        ? {
            err: q.err ? String(q.err) : null,
            ok: parseQueryInt(q.ok),
            bad: parseQueryInt(q.bad),
            dup: parseQueryInt(q.dup),
          }
        : null;
    res.render('admin-users', {
      ...adminLocals(req, res, ctx, {
        users: r.rows,
        activeNav: 'admin-users',
        userErr: q.err || null,
        userSaved: String(q.saved || '') === '1',
        bulkImport,
        maxBulkRows: ctx.config.MAX_CSV_ROWS,
      }),
    });
  });

  app.get('/admin/users/sample.csv', requireMaster, (req, res) => {
    const csv = 'email\nusuario.ejemplo@mali.pe\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="usuarios_ejemplo.csv"');
    res.send(csv);
  });

  app.get('/admin/users/new', requireMaster, (req, res) => {
    res.render('admin-user-form', {
      ...adminLocals(req, res, ctx, {
        activeNav: 'admin-users',
        mode: 'create',
        userRow: null,
        formError: null,
      }),
    });
  });

  app.post(
    '/admin/users/bulk-import',
    requireMaster,
    usersBulkImportLimiter,
    (req, res, next) => {
      usersBulkImportUpload.single('bulkfile')(req, res, (err) => {
        if (err) {
          if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
            return res.redirect(`${appPath('/admin/users')}?bulk_import=1&err=too_big`);
          }
          return res.redirect(`${appPath('/admin/users')}?bulk_import=1&err=type`);
        }
        next();
      });
    },
    async (req, res) => {
      if (!req.file || !req.file.buffer.length) {
        return res.redirect(`${appPath('/admin/users')}?bulk_import=1&err=no_file`);
      }

      const password = String(req.body.password || '');
      const area = normalizeArea(req.body.area);
      if (!isValidBusinessArea(area)) {
        return res.redirect(`${appPath('/admin/users')}?bulk_import=1&err=bad_area`);
      }
      if (password.length < 6) {
        return res.redirect(`${appPath('/admin/users')}?bulk_import=1&err=weak_password`);
      }

      const nameLower = String(req.file.originalname || '').toLowerCase();
      let parsed;
      try {
        parsed = nameLower.endsWith('.xlsx')
          ? parseUsersBulkXlsxBuffer(req.file.buffer)
          : parseUsersBulkCsvBuffer(req.file.buffer);
      } catch {
        return res.redirect(`${appPath('/admin/users')}?bulk_import=1&err=parse`);
      }

      if (parsed.tooMany) {
        return res.redirect(`${appPath('/admin/users')}?bulk_import=1&err=too_many`);
      }
      if (parsed.noSheet) {
        return res.redirect(`${appPath('/admin/users')}?bulk_import=1&err=empty`);
      }
      if (parsed.emails.length === 0 && parsed.bad === 0) {
        return res.redirect(`${appPath('/admin/users')}?bulk_import=1&err=empty`);
      }
      if (parsed.emails.length === 0) {
        const qp = new URLSearchParams({
          bulk_import: '1',
          ok: '0',
          bad: String(parsed.bad),
          dup: '0',
        });
        return res.redirect(`${appPath('/admin/users')}?${qp.toString()}`);
      }

      let ok = 0;
      let dup = 0;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        for (let i = 0; i < parsed.emails.length; i += 1) {
          const email = parsed.emails[i];
          const sp = `sp_bulk_${i}`;
          await client.query(`SAVEPOINT ${sp}`);
          try {
            const hash = await bcrypt.hash(password, 10);
            await client.query(
              `INSERT INTO users (email, password_hash, area, is_master, must_change_password, can_edit_ai_prompt) VALUES ($1, $2, $3, FALSE, TRUE, FALSE)`,
              [email, hash, area]
            );
            ok += 1;
            await client.query(`RELEASE SAVEPOINT ${sp}`);
          } catch (e) {
            await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
            if (String(e.code) === '23505') {
              dup += 1;
            } else {
              throw e;
            }
          }
        }
        await client.query('COMMIT');
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* ignore */
        }
        throw e;
      } finally {
        client.release();
      }

      const qp = new URLSearchParams({
        bulk_import: '1',
        ok: String(ok),
        bad: String(parsed.bad),
        dup: String(dup),
      });
      auditLog(query, {
        req,
        event_type: AuditEvent.ADMIN_USERS_BULK_IMPORT,
        message: `Importación masiva de usuarios en área ${area}: ${ok} creados`,
        meta: { area, created: ok, invalid_in_file: parsed.bad, duplicates_skipped: dup },
      });
      res.redirect(`${appPath('/admin/users')}?${qp.toString()}`);
    }
  );

  app.post('/admin/users', requireMaster, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const area = normalizeArea(req.body.area);
    const isMaster = String(req.body.is_master || '') === '1' || req.body.is_master === 'on';
    const mustChangePassword =
      String(req.body.must_change_password || '') === '1' || req.body.must_change_password === 'on';
    const perms = parseUserSettingsPerms(req.body);

    if (!isValidMaliEmail(email)) {
      return res.status(400).render('admin-user-form', {
        ...adminLocals(req, res, ctx, {
          activeNav: 'admin-users',
          mode: 'create',
          userRow: userRowWithPerms(
            { email, area, is_master: isMaster, must_change_password: mustChangePassword },
            perms
          ),
          formError: 'Correo invalido (debe ser @mali.pe)',
        }),
      });
    }
    if (password.length < 6) {
      return res.status(400).render('admin-user-form', {
        ...adminLocals(req, res, ctx, {
          activeNav: 'admin-users',
          mode: 'create',
          userRow: userRowWithPerms(
            { email, area, is_master: isMaster, must_change_password: mustChangePassword },
            perms
          ),
          formError: 'La contraseña debe tener al menos 6 caracteres',
        }),
      });
    }
    if (!isValidBusinessArea(area)) {
      return res.status(400).send('Area invalida');
    }

    try {
      const hash = await bcrypt.hash(password, 10);
      const ins = await query(
        `INSERT INTO users (email, password_hash, area, is_master, must_change_password, can_edit_ai_prompt, can_view_audit_logs, can_view_integration, can_edit_business_hours, can_view_reports) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
        [
          email,
          hash,
          area,
          isMaster,
          mustChangePassword,
          perms.canEditAiPrompt,
          perms.canViewAuditLogs,
          perms.canViewIntegration,
          perms.canEditBusinessHours,
          perms.canViewReports,
        ]
      );
      const userId = ins.rows[0]?.id;
      if (userId != null) {
        await replaceExtraAreasForUser(
          query,
          userId,
          area,
          parseExtraAreasFromBody(req.body)
        );
      }
      auditLog(query, {
        req,
        event_type: AuditEvent.ADMIN_USER_CREATED,
        message: `Usuario creado: ${email}`,
        meta: {
          new_user_email: email,
          area,
          is_master: isMaster,
          must_change_password: mustChangePassword,
          can_view_integration: perms.canViewIntegration,
          can_edit_ai_prompt: perms.canEditAiPrompt,
          can_edit_business_hours: perms.canEditBusinessHours,
          can_view_audit_logs: perms.canViewAuditLogs,
          can_view_reports: perms.canViewReports,
        },
      });
      res.redirect(`${appPath('/admin/users')}?saved=1`);
    } catch (e) {
      if (String(e.code) === '23505') {
        return res.status(400).render('admin-user-form', {
          ...adminLocals(req, res, ctx, {
            activeNav: 'admin-users',
            mode: 'create',
            userRow: userRowWithPerms(
              { email, area, is_master: isMaster, must_change_password: mustChangePassword },
              perms
            ),
            formError: 'Ese correo ya existe',
          }),
        });
      }
      throw e;
    }
  });

  app.get('/admin/users/:id/edit', requireMaster, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).send('ID invalido');
    }
    const r = await query(
      `SELECT id, email, area, is_master, must_change_password, ${USER_SETTINGS_PERM_COLS} FROM users WHERE id = $1`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).send('Usuario no encontrado');
    }
    const extraAreas = await fetchExtraAreasForUser(query, id);
    res.render('admin-user-form', {
      ...adminLocals(req, res, ctx, {
        activeNav: 'admin-users',
        mode: 'edit',
        userRow: { ...r.rows[0], extra_areas: extraAreas },
        formError: null,
      }),
    });
  });

  app.post('/admin/users/:id', requireMaster, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).send('ID invalido');
    }
    const area = normalizeArea(req.body.area);
    const isMaster = String(req.body.is_master || '') === '1' || req.body.is_master === 'on';
    const password = String(req.body.password || '').trim();
    const mustChangePassword =
      String(req.body.must_change_password || '') === '1' || req.body.must_change_password === 'on';
    const perms = parseUserSettingsPerms(req.body);

    if (!isValidBusinessArea(area)) {
      return res.status(400).send('Area invalida');
    }

    const existing = await query(`SELECT id, email FROM users WHERE id = $1`, [id]);
    if (existing.rowCount === 0) {
      return res.status(404).send('Usuario no encontrado');
    }

    if (password.length > 0 && password.length < 6) {
      const r = await query(
        `SELECT id, email, area, is_master, must_change_password, ${USER_SETTINGS_PERM_COLS} FROM users WHERE id = $1`,
        [id]
      );
      return res.status(400).render('admin-user-form', {
        ...adminLocals(req, res, ctx, {
          activeNav: 'admin-users',
          mode: 'edit',
          userRow: userRowWithPerms(
            {
              ...r.rows[0],
              area,
              is_master: isMaster,
              must_change_password: mustChangePassword,
            },
            perms
          ),
          formError: 'La contraseña debe tener al menos 6 caracteres',
        }),
      });
    }

    if (password.length > 0) {
      const hash = await bcrypt.hash(password, 10);
      await query(
        `UPDATE users SET area = $1, is_master = $2, password_hash = $3, must_change_password = FALSE, can_edit_ai_prompt = $4, can_view_audit_logs = $5, can_view_integration = $6, can_edit_business_hours = $7, can_view_reports = $8 WHERE id = $9`,
        [
          area,
          isMaster,
          hash,
          perms.canEditAiPrompt,
          perms.canViewAuditLogs,
          perms.canViewIntegration,
          perms.canEditBusinessHours,
          perms.canViewReports,
          id,
        ]
      );
    } else {
      await query(
        `UPDATE users SET area = $1, is_master = $2, must_change_password = $3, can_edit_ai_prompt = $4, can_view_audit_logs = $5, can_view_integration = $6, can_edit_business_hours = $7, can_view_reports = $8 WHERE id = $9`,
        [
          area,
          isMaster,
          mustChangePassword,
          perms.canEditAiPrompt,
          perms.canViewAuditLogs,
          perms.canViewIntegration,
          perms.canEditBusinessHours,
          perms.canViewReports,
          id,
        ]
      );
    }

    await replaceExtraAreasForUser(query, id, area, parseExtraAreasFromBody(req.body));

    if (id === req.session.userId) {
      req.session.area = area;
      req.session.isMaster = isMaster;
      req.session.canViewAuditLogs = perms.canViewAuditLogs;
      req.session.canViewIntegration = perms.canViewIntegration;
      req.session.canEditAiPrompt = perms.canEditAiPrompt;
      req.session.canEditBusinessHours = perms.canEditBusinessHours;
      req.session.canViewReports = perms.canViewReports;
      if (password.length > 0) {
        req.session.mustChangePassword = false;
      } else {
        req.session.mustChangePassword = mustChangePassword;
      }
    }

    auditLog(query, {
      req,
      event_type: AuditEvent.ADMIN_USER_UPDATED,
      message: `Usuario actualizado: ${existing.rows[0].email} (id ${id})`,
      meta: {
        target_user_id: id,
        target_email: existing.rows[0].email,
        new_area: area,
        is_master: isMaster,
        password_changed: password.length > 0,
        must_change_password: mustChangePassword,
        can_view_integration: perms.canViewIntegration,
        can_edit_ai_prompt: perms.canEditAiPrompt,
        can_edit_business_hours: perms.canEditBusinessHours,
        can_view_audit_logs: perms.canViewAuditLogs,
        can_view_reports: perms.canViewReports,
      },
    });

    res.redirect(`${appPath('/admin/users')}?saved=1`);
  });

  app.post('/admin/users/:id/delete', requireMaster, async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id < 1) {
      return res.status(400).send('ID invalido');
    }
    if (id === req.session.userId) {
      return res.redirect(`${appPath('/admin/users')}?err=self`);
    }
    const victim = await query(`SELECT email FROM users WHERE id = $1`, [id]);
    const victimEmail = victim.rows[0]?.email || `id ${id}`;
    await query(`DELETE FROM users WHERE id = $1`, [id]);
    auditLog(query, {
      req,
      event_type: AuditEvent.ADMIN_USER_DELETED,
      message: `Usuario eliminado: ${victimEmail}`,
      meta: { target_user_id: id, target_email: victim.rows[0]?.email || null },
    });
    res.redirect(`${appPath('/admin/users')}?saved=1`);
  });

  app.get('/admin/meta', requireMaster, async (req, res) => {
    const r = await query(`SELECT area, key, value FROM app_settings WHERE key LIKE 'meta.%'`);
    const rows = { global: {} };
    for (const slug of config.BUSINESS_AREAS) {
      rows[slug] = {};
    }
    for (const row of r.rows) {
      const a = String(row.area || '').trim();
      if (rows[a]) rows[a][row.key] = row.value;
    }
    res.render('admin-meta', {
      ...adminLocals(req, res, ctx, {
        activeNav: 'admin-meta',
        metaRows: rows,
        keys: KEYS,
        metaSaved: String(req.query.saved || '') === '1',
      }),
    });
  });

  app.get('/admin/areas', requireMaster, async (req, res) => {
    const [usersByArea, contactsByArea, campaignsByArea, segmentsByArea] = await Promise.all([
      query(`SELECT area, COUNT(*)::int AS total FROM users GROUP BY area`),
      query(`SELECT area, COUNT(*)::int AS total FROM contacts GROUP BY area`),
      query(`SELECT area, COUNT(*)::int AS total FROM campaigns GROUP BY area`),
      query(`SELECT area, COUNT(*)::int AS total FROM segment_definitions GROUP BY area`),
    ]);

    const usersMap = new Map(usersByArea.rows.map((row) => [String(row.area), Number(row.total || 0)]));
    const contactsMap = new Map(contactsByArea.rows.map((row) => [String(row.area), Number(row.total || 0)]));
    const campaignsMap = new Map(campaignsByArea.rows.map((row) => [String(row.area), Number(row.total || 0)]));
    const segmentsMap = new Map(segmentsByArea.rows.map((row) => [String(row.area), Number(row.total || 0)]));

    const areaRows = AREA_DEFS.map((area) => ({
      slug: area.slug,
      label: area.label,
      users: usersMap.get(area.slug) || 0,
      contacts: contactsMap.get(area.slug) || 0,
      campaigns: campaignsMap.get(area.slug) || 0,
      segments: segmentsMap.get(area.slug) || 0,
    }));

    res.render('admin-areas', {
      ...adminLocals(req, res, ctx, {
        activeNav: 'admin-areas',
        areaRows,
      }),
    });
  });

  app.post('/admin/meta', requireMaster, async (req, res) => {
    const b = req.body;

    await upsertMetaSetting(query, 'global', KEYS.verifyToken, b.verify_token);
    await upsertMetaSetting(query, 'global', KEYS.appSecret, b.app_secret);

    await upsertMetaSetting(query, 'ti', KEYS.whatsappToken, b.ti_whatsapp_token);
    await upsertMetaSetting(query, 'ti', KEYS.phoneNumberId, b.ti_phone_number_id);
    await upsertMetaSetting(query, 'ti', KEYS.wabaId, b.ti_waba_id);

    await upsertMetaSetting(query, 'pam', KEYS.whatsappToken, b.pam_whatsapp_token);
    await upsertMetaSetting(query, 'pam', KEYS.phoneNumberId, b.pam_phone_number_id);
    await upsertMetaSetting(query, 'pam', KEYS.wabaId, b.pam_waba_id);

    await upsertMetaSetting(query, 'patronato', KEYS.whatsappToken, b.patronato_whatsapp_token);
    await upsertMetaSetting(query, 'patronato', KEYS.phoneNumberId, b.patronato_phone_number_id);
    await upsertMetaSetting(query, 'patronato', KEYS.wabaId, b.patronato_waba_id);

    await upsertMetaSetting(query, 'educacion', KEYS.whatsappToken, b.edu_whatsapp_token);
    await upsertMetaSetting(query, 'educacion', KEYS.phoneNumberId, b.edu_phone_number_id);
    await upsertMetaSetting(query, 'educacion', KEYS.wabaId, b.edu_waba_id);

    await upsertMetaSetting(query, 'educacion_ca', KEYS.whatsappToken, b.edu_ca_whatsapp_token);
    await upsertMetaSetting(query, 'educacion_ca', KEYS.phoneNumberId, b.edu_ca_phone_number_id);
    await upsertMetaSetting(query, 'educacion_ca', KEYS.wabaId, b.edu_ca_waba_id);

    await upsertMetaSetting(query, 'educacion_ep', KEYS.whatsappToken, b.edu_ep_whatsapp_token);
    await upsertMetaSetting(query, 'educacion_ep', KEYS.phoneNumberId, b.edu_ep_phone_number_id);
    await upsertMetaSetting(query, 'educacion_ep', KEYS.wabaId, b.edu_ep_waba_id);

    await refreshMetaSettingsCache(query);
    auditLog(query, {
      req,
      event_type: AuditEvent.ADMIN_META_UPDATED,
      message: 'Credenciales Meta guardadas desde el panel',
      meta: { fields_with_value: metaAuditNonEmptyKeys(b) },
    });
    res.redirect(`${appPath('/admin/meta')}?saved=1`);
  });
}

module.exports = { registerAdmin };
