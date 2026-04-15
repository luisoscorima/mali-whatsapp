const {
  CAMPAIGN_LOG_STATUS_SQL,
  sqlInList,
  SALIDA_OK_STATUSES,
  ERROR_STATUSES,
} = require('../utils/campaignLogStatuses');

const LOG_STATUS = CAMPAIGN_LOG_STATUS_SQL;
const SALIDA_OK_IN = sqlInList(SALIDA_OK_STATUSES);
const ERROR_IN = sqlInList(ERROR_STATUSES);

function registerInboxViews(app, ctx) {
  const { query, config, loadSegments, loadSyncedTemplates, resolveAppBaseUrl, appPath } = ctx;

  async function loadCampaignsRecent(area, limit = 200) {
    const r = await query(
      `SELECT
        c.id,
        c.segment,
        c.template_name,
        c.message_text,
        c.image_url,
        c.status,
        c.total_recipients,
        c.created_at,
        COALESCE(COUNT(cl.id), 0)::int AS log_count,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${SALIDA_OK_IN} THEN 1 ELSE 0 END), 0)::int AS salida_ok,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
        COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${ERROR_IN} THEN 1 ELSE 0 END), 0)::int AS failed_count
       FROM campaigns c
       LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
       WHERE c.area = $1
       GROUP BY c.id
       ORDER BY c.id DESC
       LIMIT $2`,
      [area, limit]
    );
    return r.rows;
  }

  async function loadCampaignTotals(area) {
    const r = await query(
      `SELECT
         COUNT(cl.id)::int AS total_logs,
         COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${SALIDA_OK_IN} THEN 1 ELSE 0 END), 0)::int AS salida_ok,
         COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
         COALESCE(SUM(CASE WHEN ${LOG_STATUS} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
         COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${ERROR_IN} THEN 1 ELSE 0 END), 0)::int AS failed_count
       FROM campaigns c
       LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
       WHERE c.area = $1`,
      [area]
    );
    return r.rows[0] || {
      total_logs: 0,
      salida_ok: 0,
      delivered_count: 0,
      read_count: 0,
      failed_count: 0,
    };
  }

  async function loadCampaignDetail(area, campaignId) {
    const [campaignResult, logsResult] = await Promise.all([
      query(`SELECT * FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, area]),
      query(
        `SELECT id, phone, whatsapp_message_id, status, response, created_at
         FROM campaign_logs
         WHERE campaign_id = $1
         ORDER BY id DESC`,
        [campaignId]
      ),
    ]);
    if (campaignResult.rowCount === 0) return null;
    return { campaign: campaignResult.rows[0], logs: logsResult.rows };
  }

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

  /* --- Campañas (envío) --- */
  app.get('/campaigns/new', async (req, res) => {
    const area = req.user.area;
    const [segmentsList, campaigns, syncedTemplates] = await Promise.all([
      loadSegments(area),
      loadCampaignsRecent(area, 200),
      loadSyncedTemplates(area),
    ]);
    res.render('campaigns-new', {
      ...commonLocals(req, res),
      activeNav: 'campaigns',
      pageTitle: 'Nueva campaña · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      campaigns,
      syncedTemplates,
      templatesSynced: String(req.query.templates_synced || '') === '1',
      templatesSyncError: req.query.templates_sync_err || null,
      extraHeadScripts: [`${config.basePath || ''}/js/campaign-template.js`],
    });
  });

  app.get('/campaigns/:id', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).send('Id de campana invalido');
    }
    const area = req.user.area;
    const detail = await loadCampaignDetail(area, campaignId);
    if (!detail) {
      return res.status(404).send('Campaña no encontrada');
    }
    const campaigns = await loadCampaignsRecent(area, 200);
    res.render('campaign-detail', {
      ...commonLocals(req, res),
      activeNav: 'campaigns',
      pageTitle: `Campaña #${campaignId} · MALI WhatsApp`,
      layoutModifier: 'conversations-inbox--detail',
      campaign: detail.campaign,
      logs: detail.logs,
      campaigns,
      listBasePath: '/campaigns',
      sidebarTitle: 'Campañas',
      showNewLink: true,
      selectedCampaignId: campaignId,
    });
  });

  app.get('/campaigns', async (req, res) => {
    const area = req.user.area;
    const [campaigns, campaignTotals] = await Promise.all([loadCampaignsRecent(area, 200), loadCampaignTotals(area)]);
    res.render('campaigns-index', {
      ...commonLocals(req, res),
      activeNav: 'campaigns',
      pageTitle: 'Campañas · MALI WhatsApp',
      layoutModifier: '',
      campaigns,
      campaignTotals,
      templatesSynced: String(req.query.templates_synced || '') === '1',
    });
  });

  /* Redirecciones antiguas (historial unificado en Campañas) */
  app.get('/history', (req, res) => {
    res.redirect(302, appPath('/campaigns'));
  });
  app.get('/history/:id', (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.redirect(302, appPath('/campaigns'));
    }
    res.redirect(302, appPath(`/campaigns/${campaignId}`));
  });

  /* --- Contactos --- */
  app.get('/contacts/new', async (req, res) => {
    const area = req.user.area;
    const [segmentsList, contactsResult] = await Promise.all([
      loadSegments(area),
      query(
        `SELECT id, name, phone, segment, opt_in, active, created_at
         FROM contacts
         WHERE area = $1
         ORDER BY id DESC
         LIMIT 400`,
        [area]
      ),
    ]);
    res.render('contacts-page', {
      ...commonLocals(req, res),
      activeNav: 'contacts',
      pageTitle: 'Nuevo contacto · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      contacts: contactsResult.rows,
      view: 'new',
      selectedContactId: null,
      contact: null,
      csvImport:
        String(req.query.contacts_import || '') === '1'
          ? {
              ok: req.query.ok !== undefined ? Number(req.query.ok) : null,
              bad: req.query.bad !== undefined ? Number(req.query.bad) : null,
              err: req.query.err || null,
            }
          : null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: String(req.query.contact_updated || '') === '1',
      contactDeleted: String(req.query.contact_deleted || '') === '1',
    });
  });

  app.get('/contacts/:id', async (req, res) => {
    const contactId = Number(req.params.id);
    if (!Number.isInteger(contactId) || contactId <= 0) {
      return res.status(400).send('Id de contacto invalido');
    }
    const area = req.user.area;
    const [segmentsList, contactsResult, one] = await Promise.all([
      loadSegments(area),
      query(
        `SELECT id, name, phone, segment, opt_in, active, created_at
         FROM contacts
         WHERE area = $1
         ORDER BY id DESC
         LIMIT 400`,
        [area]
      ),
      query(`SELECT id, name, phone, segment, opt_in, active, created_at FROM contacts WHERE id = $1 AND area = $2`, [
        contactId,
        area,
      ]),
    ]);
    if (one.rowCount === 0) {
      return res.status(404).send('Contacto no encontrado');
    }
    res.render('contacts-page', {
      ...commonLocals(req, res),
      activeNav: 'contacts',
      pageTitle: `${one.rows[0].name || one.rows[0].phone} · Contactos · MALI WhatsApp`,
      layoutModifier: 'conversations-inbox--detail',
      segments: segmentsList,
      contacts: contactsResult.rows,
      view: 'edit',
      selectedContactId: contactId,
      contact: one.rows[0],
      csvImport: null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: String(req.query.contact_updated || '') === '1',
      contactDeleted: String(req.query.contact_deleted || '') === '1',
    });
  });

  app.get('/contacts', async (req, res) => {
    const area = req.user.area;
    const [segmentsList, contactsResult] = await Promise.all([
      loadSegments(area),
      query(
        `SELECT id, name, phone, segment, opt_in, active, created_at
         FROM contacts
         WHERE area = $1
         ORDER BY id DESC
         LIMIT 400`,
        [area]
      ),
    ]);
    res.render('contacts-page', {
      ...commonLocals(req, res),
      activeNav: 'contacts',
      pageTitle: 'Contactos · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      contacts: contactsResult.rows,
      view: 'list',
      selectedContactId: null,
      contact: null,
      csvImport:
        String(req.query.contacts_import || '') === '1'
          ? {
              ok: req.query.ok !== undefined ? Number(req.query.ok) : null,
              bad: req.query.bad !== undefined ? Number(req.query.bad) : null,
              err: req.query.err || null,
            }
          : null,
      maxCsvRows: config.MAX_CSV_ROWS,
      contactUpdated: String(req.query.contact_updated || '') === '1',
      contactDeleted: String(req.query.contact_deleted || '') === '1',
    });
  });

  /* --- Segmentos --- */
  app.get('/segments/new', async (req, res) => {
    const area = req.user.area;
    const segmentsList = await loadSegments(area);
    res.render('segments-page', {
      ...commonLocals(req, res),
      activeNav: 'segments',
      pageTitle: 'Añadir segmento · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      view: 'new',
      selectedSegmentId: null,
      selectedSegment: null,
      segmentsSaved: String(req.query.segments_saved || '') === '1',
    });
  });

  app.get('/segments/:id', async (req, res) => {
    const segId = Number(req.params.id);
    if (!Number.isInteger(segId) || segId <= 0) {
      return res.status(400).send('Id de segmento invalido');
    }
    const area = req.user.area;
    const segmentsList = await loadSegments(area);
    const sel = segmentsList.find((s) => s.id === segId);
    if (!sel) {
      return res.status(404).send('Segmento no encontrado');
    }
    res.render('segments-page', {
      ...commonLocals(req, res),
      activeNav: 'segments',
      pageTitle: `${sel.label} · Segmentos · MALI WhatsApp`,
      layoutModifier: 'conversations-inbox--detail',
      segments: segmentsList,
      view: 'detail',
      selectedSegmentId: segId,
      selectedSegment: sel,
      segmentsSaved: String(req.query.segments_saved || '') === '1',
    });
  });

  app.get('/segments', async (req, res) => {
    const area = req.user.area;
    const segmentsList = await loadSegments(area);
    res.render('segments-page', {
      ...commonLocals(req, res),
      activeNav: 'segments',
      pageTitle: 'Segmentos · MALI WhatsApp',
      layoutModifier: '',
      segments: segmentsList,
      view: 'list',
      selectedSegmentId: null,
      selectedSegment: null,
      segmentsSaved: String(req.query.segments_saved || '') === '1',
    });
  });

  /* --- Ajustes --- */
  app.get('/settings', async (req, res) => {
    res.render('settings-page', {
      ...commonLocals(req, res),
      activeNav: 'settings',
      pageTitle: 'Ajustes · MALI WhatsApp',
      layoutModifier: '',
    });
  });
}

module.exports = { registerInboxViews };
