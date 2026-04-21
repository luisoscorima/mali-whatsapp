const {
  CAMPAIGN_LOG_STATUS_SQL,
  sqlInList,
  SALIDA_OK_STATUSES,
  ERROR_STATUSES,
} = require('../utils/campaignLogStatuses');

const LOG_STATUS = CAMPAIGN_LOG_STATUS_SQL;
const SALIDA_OK_IN = sqlInList(SALIDA_OK_STATUSES);
const ERROR_IN = sqlInList(ERROR_STATUSES);

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
          `SELECT
             c.id,
             c.name,
             c.phone,
             c.opt_in,
             c.active,
             c.created_at,
             COALESCE((
               SELECT array_agg(cs.segment_slug ORDER BY sd.sort_order NULLS LAST, cs.segment_slug)
               FROM contact_segments cs
               JOIN segment_definitions sd ON sd.area = cs.area AND sd.slug = cs.segment_slug
               WHERE cs.contact_id = c.id
             ), ARRAY[]::varchar[]) AS segment_slugs
           FROM contacts c
           WHERE c.area = $1
           ORDER BY c.id DESC
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
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${SALIDA_OK_IN} THEN 1 ELSE 0 END), 0)::int AS salida_ok,
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ('delivered', 'read') THEN 1 ELSE 0 END), 0)::int AS delivered_count,
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} = 'read' THEN 1 ELSE 0 END), 0)::int AS read_count,
             COALESCE(SUM(CASE WHEN ${LOG_STATUS} IN ${ERROR_IN} THEN 1 ELSE 0 END), 0)::int AS failed_count
           FROM campaigns c
           LEFT JOIN campaign_logs cl ON cl.campaign_id = c.id
           WHERE c.area = $1
           GROUP BY c.id
           ORDER BY c.id DESC
           LIMIT 25`,
          [area]
        ),
        query(
          `SELECT cs.segment_slug AS segment, COUNT(DISTINCT cs.contact_id)::int AS total
           FROM contact_segments cs
           INNER JOIN contacts c ON c.id = cs.contact_id AND c.area = cs.area
           WHERE c.area = $1 AND c.active = TRUE
           GROUP BY cs.segment_slug
           ORDER BY cs.segment_slug`,
          [area]
        ),
        query(
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
        ),
      ]);

      const campaignTotals = campaignTotalsResult.rows[0] || {
        total_logs: 0,
        salida_ok: 0,
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
