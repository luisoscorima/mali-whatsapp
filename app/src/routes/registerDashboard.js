function registerDashboard(app, ctx) {
  const { query, config, loadSegments, loadSyncedTemplates, resolveAppBaseUrl, appPath } = ctx;

  app.get('/', async (req, res) => {
    const area = req.user.area;
    const [contactsResult, campaignsResult, statsResult, syncedTemplates] = await Promise.all([
      query(
        `SELECT id, name, phone, segment, opt_in, active, created_at
         FROM contacts
         WHERE area = $1
         ORDER BY id DESC
         LIMIT 400`,
        [area]
      ),
      query(
        `SELECT
          c.id,
          c.segment,
          c.template_name,
          c.message_text,
          c.image_url,
          c.status,
          c.total_recipients,
          c.created_at,
          COALESCE(SUM(CASE WHEN cl.status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS sent_count,
          COALESCE(SUM(CASE WHEN cl.status IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
          COALESCE(SUM(CASE WHEN cl.status = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
          COALESCE(SUM(CASE WHEN cl.status IN ('error', 'failed', 'undelivered') THEN 1 ELSE 0 END), 0)::int AS failed_count
         FROM campaigns c
         LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
         WHERE c.area = $1
         GROUP BY c.id
         ORDER BY c.id DESC
         LIMIT 10`,
        [area]
      ),
      query(
        `SELECT segment, COUNT(*)::int AS total
         FROM contacts
         WHERE active = TRUE AND area = $1
         GROUP BY segment
         ORDER BY segment`,
        [area]
      ),
      loadSyncedTemplates(area),
    ]);

    const segmentsList = await loadSegments(area);

    res.render('dashboard', {
      segments: segmentsList,
      syncedTemplates,
      contacts: contactsResult.rows,
      campaigns: campaignsResult.rows,
      stats: statsResult.rows,
      requireAuth: config.requireAuth,
      currentUser: req.user,
      areaLabel: res.locals.areaLabel,
      templatesSynced: String(req.query.templates_synced || '') === '1',
      templatesSyncError: req.query.templates_sync_err || null,
      segmentsSaved: String(req.query.segments_saved || '') === '1',
      csvImport:
        String(req.query.contacts_import || '') === '1'
          ? {
              ok: req.query.ok !== undefined ? Number(req.query.ok) : null,
              bad: req.query.bad !== undefined ? Number(req.query.bad) : null,
              err: req.query.err || null,
            }
          : null,
      maxCsvRows: config.MAX_CSV_ROWS,
      appBaseUrl: resolveAppBaseUrl(),
      activeNav: 'dashboard',
      contactUpdated: String(req.query.contact_updated || '') === '1',
      contactDeleted: String(req.query.contact_deleted || '') === '1',
    });
  });

  app.get('/api/dashboard', async (req, res) => {
    try {
      const area = req.user.area;
      const [contactsResult, campaignsResult, statsResult] = await Promise.all([
        query(
          `SELECT id, name, phone, segment, opt_in, active, created_at
           FROM contacts
           WHERE area = $1
           ORDER BY id DESC
           LIMIT 25`,
          [area]
        ),
        query(
          `SELECT
             c.id,
             c.segment,
             c.template_name,
             c.status,
             c.total_recipients,
             c.created_at,
             COALESCE(SUM(CASE WHEN cl.status IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS sent_count,
             COALESCE(SUM(CASE WHEN cl.status IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
             COALESCE(SUM(CASE WHEN cl.status = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
             COALESCE(SUM(CASE WHEN cl.status IN ('error', 'failed', 'undelivered') THEN 1 ELSE 0 END), 0)::int AS failed_count
           FROM campaigns c
           LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
           WHERE c.area = $1
           GROUP BY c.id
           ORDER BY c.id DESC
           LIMIT 25`,
          [area]
        ),
        query(
          `SELECT segment, COUNT(*)::int AS total
           FROM contacts
           WHERE active = TRUE AND area = $1
           GROUP BY segment
           ORDER BY segment`,
          [area]
        ),
      ]);

      res.json({
        ok: true,
        contacts: contactsResult.rows,
        campaigns: campaignsResult.rows,
        stats: statsResult.rows,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerDashboard };
