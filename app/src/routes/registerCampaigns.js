const { logError } = require('../utils/logger');
const { campaignLimiter } = require('../middleware/limiters');
const { runCampaignSendJob } = require('../services/campaignSender');

function registerCampaigns(app, ctx) {
  const { query, getSegmentSlugSet, validateCampaignWithSync, appPath, resolveAppBaseUrl } = ctx;

  app.post('/campaigns/send', campaignLimiter, async (req, res) => {
    const area = req.user.area;
    const segmentSet = await getSegmentSlugSet(area);
    const templateSyncId = parseInt(String(req.body.templateSyncId || '').trim(), 10);
    let templateRow = null;
    if (Number.isInteger(templateSyncId) && templateSyncId > 0) {
      const tr = await query(
        `SELECT id, name, language, category, status, components_json FROM whatsapp_templates WHERE id = $1 AND area = $2`,
        [templateSyncId, area]
      );
      if (tr.rowCount > 0) templateRow = tr.rows[0];
    }
    const validation = validateCampaignWithSync(req.body, segmentSet, templateRow);
    if (!validation.ok) {
      return res.status(400).send(validation.message);
    }

    const {
      segment,
      templateRow: tRow,
      values,
      messageText,
      imageUrl,
      batchSize,
      batchDelayMs,
    } = validation.value;

    try {
      const recipientsResult = await query(
        `SELECT id, name, phone
         FROM contacts
         WHERE segment = $1
           AND area = $2
           AND opt_in = TRUE
           AND active = TRUE
         ORDER BY id ASC`,
        [segment, area]
      );
      const recipients = recipientsResult.rows;

      const templateSnapshot = {
        id: tRow.id,
        name: tRow.name,
        language: tRow.language,
        category: tRow.category,
        components_json: tRow.components_json,
      };

      const staticParams = {
        headerParams: values.headerParams,
        bodyParams: values.bodyParams,
        buttonParams: values.buttonParams,
        headerMediaUrl: values.headerMediaUrl,
      };

      const campaignPayload = {
        area,
        segment,
        templateSnapshot,
        staticParams,
        batchSize,
        batchDelayMs,
      };

      const campaignResult = await query(
        `INSERT INTO campaigns (area, segment, template_name, message_text, image_url, status, total_recipients, campaign_payload)
         VALUES ($1, $2, $3, $4, $5, 'queued', $6, $7::jsonb)
         RETURNING id`,
        [area, segment, tRow.name, messageText, imageUrl, recipients.length, JSON.stringify(campaignPayload)]
      );

      const campaignId = campaignResult.rows[0].id;

      setImmediate(() => runCampaignSendJob(query, { campaignId, ...campaignPayload }));

      res.redirect(appPath(`/campaigns/${campaignId}`));
    } catch (error) {
      logError(req, 'Error en envio de campana', error);
      res.status(500).send(`No se pudo enviar la campaña: ${error.message}`);
    }
  });

  app.get('/campaigns/:id', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).send('Id de campana invalido');
    }

    const [campaignResult, logsResult] = await Promise.all([
      query(`SELECT * FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, req.user.area]),
      query(
        `SELECT id, phone, whatsapp_message_id, status, response, created_at
         FROM campaign_logs
         WHERE campaign_id = $1
         ORDER BY id DESC`,
        [campaignId]
      ),
    ]);

    if (campaignResult.rowCount === 0) {
      return res.status(404).send('Campaña no encontrada');
    }

    res.render('campaign-detail', {
      campaign: campaignResult.rows[0],
      logs: logsResult.rows,
      basePath: ctx.config.basePath,
      areaLabel: res.locals.areaLabel,
      requireAuth: ctx.config.requireAuth,
      currentUser: req.user,
      appBaseUrl: resolveAppBaseUrl(),
      showAdminNav: res.locals.showAdminNav,
      activeNav: 'dashboard',
    });
  });

  app.get('/api/campaigns/:id', async (req, res) => {
    const campaignId = Number(req.params.id);
    if (!Number.isInteger(campaignId) || campaignId <= 0) {
      return res.status(400).json({ error: 'Id invalido' });
    }

    try {
      const [campaignResult, logsResult] = await Promise.all([
        query(`SELECT * FROM campaigns WHERE id = $1 AND area = $2`, [campaignId, req.user.area]),
        query(
          `SELECT id, phone, whatsapp_message_id, status, response, created_at
           FROM campaign_logs
           WHERE campaign_id = $1
           ORDER BY id DESC`,
          [campaignId]
        ),
      ]);

      if (campaignResult.rowCount === 0) {
        return res.status(404).json({ error: 'No encontrada' });
      }

      res.json({
        campaign: campaignResult.rows[0],
        logs: logsResult.rows,
      });
    } catch (error) {
      logError(req, 'Error API campana', error);
      res.status(500).json({ error: 'Error al cargar la campana' });
    }
  });
}

module.exports = { registerCampaigns };
