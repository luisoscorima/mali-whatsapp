const config = require('../config');
const { logError } = require('../utils/logger');
const { normalizeArea } = require('../middleware/auth');
const { loadExclusionLists, getExclusionListWithMembers } = require('../services/exclusionLists');
const { normalizePhone } = require('../utils/phone');
const { resolveAppBaseUrl } = require('./shared/routeContext');

function registerExclusionLists(app, ctx) {
  const { query, appPath } = ctx;

  app.get('/exclusion-lists', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const lists = await loadExclusionLists(query, area);
    res.render('exclusion-lists-page', {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
      activeNav: 'exclusion-lists',
      pageTitle: 'Listas de exclusión · MALI WhatsApp',
      lists,
      flash: req.query.flash || null,
      error: req.query.error || null,
    });
  });

  app.post('/exclusion-lists', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const name = String(req.body.name || '').trim().slice(0, 120);
    if (!name) {
      return res.redirect(appPath('/exclusion-lists?error=name'));
    }
    try {
      await query(`INSERT INTO exclusion_lists (area, name) VALUES ($1, $2)`, [area, name]);
      res.redirect(appPath('/exclusion-lists?flash=created'));
    } catch (e) {
      logError(req, 'Error creando lista exclusión', e);
      res.redirect(appPath('/exclusion-lists?error=duplicate'));
    }
  });

  app.get('/exclusion-lists/:id', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const listId = Number(req.params.id);
    if (!Number.isInteger(listId) || listId <= 0) {
      return res.status(400).send('Id inválido');
    }
    const data = await getExclusionListWithMembers(query, area, listId);
    if (!data) return res.status(404).send('Lista no encontrada');
    res.render('exclusion-list-detail', {
      basePath: config.basePath,
      appBaseUrl: resolveAppBaseUrl(),
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      showAdminNav: res.locals.showAdminNav,
      activeNav: 'exclusion-lists',
      pageTitle: `${data.list.name} · Exclusión`,
      list: data.list,
      members: data.members,
      flash: req.query.flash || null,
      error: req.query.error || null,
    });
  });

  app.post('/exclusion-lists/:id/members', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const listId = Number(req.params.id);
    const phoneRaw = String(req.body.phone || '').trim();
    const phone = normalizePhone(phoneRaw);
    if (!phone) {
      return res.redirect(appPath(`/exclusion-lists/${listId}?error=phone`));
    }
    const listR = await query(
      `SELECT id FROM exclusion_lists WHERE id = $1 AND area = $2`,
      [listId, area]
    );
    if (listR.rowCount === 0) return res.status(404).send('Lista no encontrada');
    const contactR = await query(
      `SELECT id FROM contacts WHERE area = $1 AND phone = $2 LIMIT 1`,
      [area, phone]
    );
    if (contactR.rowCount === 0) {
      return res.redirect(appPath(`/exclusion-lists/${listId}?error=contact`));
    }
    await query(
      `INSERT INTO exclusion_list_members (list_id, contact_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [listId, contactR.rows[0].id]
    );
    res.redirect(appPath(`/exclusion-lists/${listId}?flash=member`));
  });

  app.post('/exclusion-lists/:id/members/:contactId/remove', async (req, res) => {
    const area = normalizeArea(req.user.area);
    const listId = Number(req.params.id);
    const contactId = Number(req.params.contactId);
    await query(
      `DELETE FROM exclusion_list_members elm
       USING exclusion_lists el
       WHERE elm.list_id = el.id AND el.id = $1 AND el.area = $2 AND elm.contact_id = $3`,
      [listId, area, contactId]
    );
    res.redirect(appPath(`/exclusion-lists/${listId}?flash=removed`));
  });
}

module.exports = { registerExclusionLists };
