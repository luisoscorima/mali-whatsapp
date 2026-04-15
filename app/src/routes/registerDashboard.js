/** Comparación de estado de campaign_logs (Meta puede enviar mezcla de mayúsculas). */
const LOG_STATUS = `LOWER(TRIM(COALESCE(cl.status, '')))`;

function registerDashboard(app, ctx) {
  const { query, config, resolveAppBaseUrl, appPath } = ctx;

  app.get('/', (req, res) => {
    res.redirect(appPath('/campaigns'));
  });

  app.get('/api/dashboard', async (req, res) => {
    try {
      const area = req.user.area;
      const [contactsResult, campaignsResult, statsResult, campaignTotalsResult] = await Promise.all([
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
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS sent_count,
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('error', 'failed', 'undelivered') THEN 1 ELSE 0 END), 0)::int AS failed_count
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
        query(
          `SELECT
             COUNT(cl.id)::int AS total_logs,
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('sent', 'delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS sent_count,
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('error', 'failed', 'undelivered') THEN 1 ELSE 0 END), 0)::int AS failed_count
           FROM campaigns c
           LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
           WHERE c.area = $1`,
          [area]
        ),
      ]);

      const campaignTotals = campaignTotalsResult.rows[0] || {
        total_logs: 0,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        failed_count: 0,
      };

      res.json({
        ok: true,
        contacts: contactsResult.rows,
        campaigns: campaignsResult.rows,
        stats: statsResult.rows,
        campaignTotals,
      });
    } catch (error) {
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerDashboard };
