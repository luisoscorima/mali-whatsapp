const multer = require('multer');
const bcrypt = require('bcryptjs');
const { normalizeArea, createRequireMaster } = require('../middleware/auth');
const { isValidMaliEmail, normalizeEmail } = require('../utils/contactsCsv');
const { parseUsersBulkCsvBuffer, parseUsersBulkXlsxBuffer } = require('../utils/usersBulkCsv');
const { usersBulkImportLimiter, usersBulkImportUpload } = require('../middleware/limiters');
const { refreshMetaSettingsCache, KEYS } = require('../services/metaSettingsCache');

function adminLocals(req, res, ctx, extra) {
  const { config, resolveAppBaseUrl, appPath } = ctx;
  return {
    basePath: config.basePath,
    requireAuth: config.requireAuth,
    currentUser: req.user,
    areaLabel: res.locals.areaLabel,
    appBaseUrl: resolveAppBaseUrl(),
    showAdminNav: res.locals.showAdminNav,
    ...extra,
  };
}

function parseQueryInt(v) {
  if (v == null || String(v).trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
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
  const { query, pool, resolveAppBaseUrl, appPath } = ctx;
  const requireMaster = createRequireMaster();
  const AREA_DEFS = [
    { slug: 'ti', label: 'TI (dev)' },
    { slug: 'pam', label: 'PAM' },
    { slug: 'educacion', label: 'Educación' },
  ];

  app.post('/admin/switch-area', requireMaster, async (req, res) => {
    const area = normalizeArea(req.body.area);
    if (area !== 'ti' && area !== 'pam' && area !== 'educacion') {
      return res.redirect(appPath('/campaigns'));
    }
    req.session.area = area;
    try {
      await query(`UPDATE users SET area = $1 WHERE id = $2`, [area, req.session.userId]);
    } catch (e) {
      console.error(
        JSON.stringify({
          level: 'warn',
          message: 'No se pudo persistir cambio de area de master',
          userId: req.session.userId || null,
          area,
          error: e?.message || 'unknown',
        })
      );
    }
    res.redirect(appPath('/campaigns'));
  });

  app.get('/admin/users', requireMaster, async (req, res) => {
    const r = await query(
      `SELECT id, email, area, is_master, must_change_password, can_edit_ai_prompt, created_at FROM users ORDER BY email ASC`
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
      if (area !== 'ti' && area !== 'pam' && area !== 'educacion') {
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
    const canEditAiPrompt =
      String(req.body.can_edit_ai_prompt || '') === '1' || req.body.can_edit_ai_prompt === 'on';

    if (!isValidMaliEmail(email)) {
      return res.status(400).render('admin-user-form', {
        ...adminLocals(req, res, ctx, {
          activeNav: 'admin-users',
          mode: 'create',
          userRow: {
            email,
            area,
            is_master: isMaster,
            must_change_password: mustChangePassword,
            can_edit_ai_prompt: canEditAiPrompt,
          },
          formError: 'Correo invalido (debe ser @mali.pe)',
        }),
      });
    }
    if (password.length < 6) {
      return res.status(400).render('admin-user-form', {
        ...adminLocals(req, res, ctx, {
          activeNav: 'admin-users',
          mode: 'create',
          userRow: {
            email,
            area,
            is_master: isMaster,
            must_change_password: mustChangePassword,
            can_edit_ai_prompt: canEditAiPrompt,
          },
          formError: 'La contraseña debe tener al menos 6 caracteres',
        }),
      });
    }
    if (area !== 'ti' && area !== 'pam' && area !== 'educacion') {
      return res.status(400).send('Area invalida');
    }

    try {
      const hash = await bcrypt.hash(password, 10);
      await query(
        `INSERT INTO users (email, password_hash, area, is_master, must_change_password, can_edit_ai_prompt) VALUES ($1, $2, $3, $4, $5, $6)`,
        [email, hash, area, isMaster, mustChangePassword, canEditAiPrompt]
      );
      res.redirect(`${appPath('/admin/users')}?saved=1`);
    } catch (e) {
      if (String(e.code) === '23505') {
        return res.status(400).render('admin-user-form', {
          ...adminLocals(req, res, ctx, {
            activeNav: 'admin-users',
            mode: 'create',
            userRow: {
              email,
              area,
              is_master: isMaster,
              must_change_password: mustChangePassword,
              can_edit_ai_prompt: canEditAiPrompt,
            },
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
      `SELECT id, email, area, is_master, must_change_password, can_edit_ai_prompt FROM users WHERE id = $1`,
      [id]
    );
    if (r.rowCount === 0) {
      return res.status(404).send('Usuario no encontrado');
    }
    res.render('admin-user-form', {
      ...adminLocals(req, res, ctx, {
        activeNav: 'admin-users',
        mode: 'edit',
        userRow: r.rows[0],
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
    const canEditAiPrompt =
      String(req.body.can_edit_ai_prompt || '') === '1' || req.body.can_edit_ai_prompt === 'on';

    if (area !== 'ti' && area !== 'pam' && area !== 'educacion') {
      return res.status(400).send('Area invalida');
    }

    const existing = await query(`SELECT id, email FROM users WHERE id = $1`, [id]);
    if (existing.rowCount === 0) {
      return res.status(404).send('Usuario no encontrado');
    }

    if (password.length > 0 && password.length < 6) {
      const r = await query(
        `SELECT id, email, area, is_master, must_change_password, can_edit_ai_prompt FROM users WHERE id = $1`,
        [id]
      );
      return res.status(400).render('admin-user-form', {
        ...adminLocals(req, res, ctx, {
          activeNav: 'admin-users',
          mode: 'edit',
          userRow: {
            ...r.rows[0],
            area,
            is_master: isMaster,
            must_change_password: mustChangePassword,
            can_edit_ai_prompt: canEditAiPrompt,
          },
          formError: 'La contraseña debe tener al menos 6 caracteres',
        }),
      });
    }

    if (password.length > 0) {
      const hash = await bcrypt.hash(password, 10);
      await query(
        `UPDATE users SET area = $1, is_master = $2, password_hash = $3, must_change_password = FALSE, can_edit_ai_prompt = $4 WHERE id = $5`,
        [area, isMaster, hash, canEditAiPrompt, id]
      );
    } else {
      await query(
        `UPDATE users SET area = $1, is_master = $2, must_change_password = $3, can_edit_ai_prompt = $4 WHERE id = $5`,
        [area, isMaster, mustChangePassword, canEditAiPrompt, id]
      );
    }

    if (id === req.session.userId) {
      req.session.area = area;
      req.session.isMaster = isMaster;
      if (password.length > 0) {
        req.session.mustChangePassword = false;
      } else {
        req.session.mustChangePassword = mustChangePassword;
      }
    }

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
    await query(`DELETE FROM users WHERE id = $1`, [id]);
    res.redirect(`${appPath('/admin/users')}?saved=1`);
  });

  app.get('/admin/meta', requireMaster, async (req, res) => {
    const r = await query(`SELECT area, key, value FROM app_settings WHERE key LIKE 'meta.%'`);
    const rows = { global: {}, ti: {}, pam: {}, educacion: {} };
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

    await upsertMetaSetting(query, 'educacion', KEYS.whatsappToken, b.edu_whatsapp_token);
    await upsertMetaSetting(query, 'educacion', KEYS.phoneNumberId, b.edu_phone_number_id);
    await upsertMetaSetting(query, 'educacion', KEYS.wabaId, b.edu_waba_id);

    await refreshMetaSettingsCache(query);
    res.redirect(`${appPath('/admin/meta')}?saved=1`);
  });
}

module.exports = { registerAdmin };
