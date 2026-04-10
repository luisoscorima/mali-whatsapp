const bcrypt = require('bcryptjs');
const { normalizeArea, createRequireMaster } = require('../middleware/auth');
const { isValidMaliEmail, normalizeEmail } = require('../utils/contactsCsv');
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
  const { query, resolveAppBaseUrl, appPath } = ctx;
  const requireMaster = createRequireMaster();

  app.post('/admin/switch-area', requireMaster, async (req, res) => {
    const area = normalizeArea(req.body.area);
    if (area !== 'pam' && area !== 'educacion') {
      return res.redirect(appPath('/'));
    }
    req.session.area = area;
    try {
      await query(`UPDATE users SET area = $1 WHERE id = $2`, [area, req.session.userId]);
    } catch {
      /* */
    }
    res.redirect(appPath('/'));
  });

  app.get('/admin/users', requireMaster, async (req, res) => {
    const r = await query(
      `SELECT id, email, area, is_master, created_at FROM users ORDER BY email ASC`
    );
    res.render('admin-users', {
      ...adminLocals(req, res, ctx, {
        users: r.rows,
        activeNav: 'admin-users',
        userErr: req.query.err || null,
        userSaved: String(req.query.saved || '') === '1',
      }),
    });
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

  app.post('/admin/users', requireMaster, async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const password = String(req.body.password || '');
    const area = normalizeArea(req.body.area);
    const isMaster = String(req.body.is_master || '') === '1' || req.body.is_master === 'on';

    if (!isValidMaliEmail(email)) {
      return res.status(400).render('admin-user-form', {
        ...adminLocals(req, res, ctx, {
          activeNav: 'admin-users',
          mode: 'create',
          userRow: { email, area, is_master: isMaster },
          formError: 'Correo invalido (debe ser @mali.pe)',
        }),
      });
    }
    if (password.length < 6) {
      return res.status(400).render('admin-user-form', {
        ...adminLocals(req, res, ctx, {
          activeNav: 'admin-users',
          mode: 'create',
          userRow: { email, area, is_master: isMaster },
          formError: 'La contraseña debe tener al menos 6 caracteres',
        }),
      });
    }
    if (area !== 'pam' && area !== 'educacion') {
      return res.status(400).send('Area invalida');
    }

    try {
      const hash = await bcrypt.hash(password, 10);
      await query(
        `INSERT INTO users (email, password_hash, area, is_master) VALUES ($1, $2, $3, $4)`,
        [email, hash, area, isMaster]
      );
      res.redirect(`${appPath('/admin/users')}?saved=1`);
    } catch (e) {
      if (String(e.code) === '23505') {
        return res.status(400).render('admin-user-form', {
          ...adminLocals(req, res, ctx, {
            activeNav: 'admin-users',
            mode: 'create',
            userRow: { email, area, is_master: isMaster },
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
    const r = await query(`SELECT id, email, area, is_master FROM users WHERE id = $1`, [id]);
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

    if (area !== 'pam' && area !== 'educacion') {
      return res.status(400).send('Area invalida');
    }

    const existing = await query(`SELECT id, email FROM users WHERE id = $1`, [id]);
    if (existing.rowCount === 0) {
      return res.status(404).send('Usuario no encontrado');
    }

    if (password.length > 0 && password.length < 6) {
      const r = await query(`SELECT id, email, area, is_master FROM users WHERE id = $1`, [id]);
      return res.status(400).render('admin-user-form', {
        ...adminLocals(req, res, ctx, {
          activeNav: 'admin-users',
          mode: 'edit',
          userRow: { ...r.rows[0], area, is_master: isMaster },
          formError: 'La contraseña debe tener al menos 6 caracteres',
        }),
      });
    }

    if (password.length > 0) {
      const hash = await bcrypt.hash(password, 10);
      await query(
        `UPDATE users SET area = $1, is_master = $2, password_hash = $3 WHERE id = $4`,
        [area, isMaster, hash, id]
      );
    } else {
      await query(`UPDATE users SET area = $1, is_master = $2 WHERE id = $3`, [area, isMaster, id]);
    }

    if (id === req.session.userId) {
      req.session.area = area;
      req.session.isMaster = isMaster;
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
    const rows = { global: {}, pam: {}, educacion: {} };
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

  app.post('/admin/meta', requireMaster, async (req, res) => {
    const b = req.body;

    await upsertMetaSetting(query, 'global', KEYS.verifyToken, b.verify_token);
    await upsertMetaSetting(query, 'global', KEYS.appSecret, b.app_secret);

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
