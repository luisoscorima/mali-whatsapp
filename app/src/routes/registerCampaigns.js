const { logError } = require('../utils/logger');
const { auditLog, AuditEvent } = require('../services/auditLog');
const config = require('../config');
const { normalizeArea } = require('../middleware/auth');
const { campaignLimiter } = require('../middleware/limiters');
const { runCampaignSendJob } = require('../services/campaignSender');
const {
  fetchRecipientsUnion,
  countRecipientsUnion,
  validateRecipientsMatchRequest,
} = require('../services/campaignRecipients');

function registerCampaigns(app, ctx) {
  const { query, getSegmentSlugSet, validateCampaignWithSync, appPath } = ctx;

  /**
   * Vista previa: unión de contactos por segmentos (sin filtrar por IDs).
   */
  app.post('/api/campaigns/recipients-preview', campaignLimiter, async (req, res) => {
    const area = normalizeArea(req.user.area);
    try {
      const raw = req.body?.segments;
      if (!Array.isArray(raw) || raw.length === 0) {
        return res.status(400).json({ ok: false, error: 'Indica al menos un segmento' });
      }
      const segmentSet = await getSegmentSlugSet(area);
      const segments = [...new Set(raw.map((s) => String(s).trim()).filter(Boolean))];
      if (segments.length === 0) {
        return res.status(400).json({ ok: false, error: 'Indica al menos un segmento' });
      }
      for (const s of segments) {
        if (!segmentSet.has(s)) {
          return res.status(400).json({ ok: false, error: 'Segmento inválido' });
        }
      }

      const maxN = config.CAMPAIGN_RECIPIENTS_PREVIEW_MAX;
      const total = await countRecipientsUnion(query, area, segments);
      if (total > maxN) {
        return res.status(400).json({
          ok: false,
          error: `Hay demasiados contactos (${total}). Máximo ${maxN}; reduce los segmentos.`,
          total,
          max: maxN,
        });
      }

      const contacts = await fetchRecipientsUnion(query, area, segments);
      return res.json({ ok: true, contacts, total: contacts.length });
    } catch (error) {
      logError(req, 'Error vista previa campaña', error);
      return res.status(500).json({ ok: false, error: 'No se pudo cargar la lista' });
    }
  });

  app.post('/campaigns/send', campaignLimiter, async (req, res) => {
    const wantsJson = String(req.headers.accept || '').includes('application/json');
    const jsonErr = (msg) => {
      if (wantsJson) return res.status(400).json({ ok: false, error: msg });
      return res.status(400).send(msg);
    };

    const area = normalizeArea(req.user.area);
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
      return jsonErr(validation.message);
    }

    const {
      segment,
      segments,
      recipientContactIds,
      audienceMode,
      templateRow: tRow,
      values,
      messageText,
      imageUrl,
      batchSize,
      batchDelayMs,
      isScheduled,
      scheduledAt,
    } = validation.value;

    try {
      let recipients;
      if (audienceMode === 'multi' && recipientContactIds && recipientContactIds.length > 0) {
        recipients = await fetchRecipientsUnion(query, area, segments, {
          contactIds: recipientContactIds,
        });
        if (!validateRecipientsMatchRequest(recipients, recipientContactIds)) {
          return jsonErr('Destinatarios inválidos o no pertenecen a los segmentos seleccionados');
        }
      } else {
        recipients = await fetchRecipientsUnion(query, area, segments);
      }

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
        segments,
        templateSnapshot,
        staticParams,
        batchSize,
        batchDelayMs,
      };
      if (audienceMode === 'multi' && recipientContactIds && recipientContactIds.length > 0) {
        campaignPayload.recipientContactIds = recipientContactIds;
      } else {
        campaignPayload.segment = segments[0];
      }

      const campaignStatus = isScheduled ? 'scheduled' : 'queued';
      const campaignResult = await query(
        `INSERT INTO campaigns (area, segment, template_name, message_text, image_url, status, total_recipients, campaign_payload, scheduled_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
         RETURNING id`,
        [
          area,
          segment,
          tRow.name,
          messageText,
          imageUrl,
          campaignStatus,
          recipients.length,
          JSON.stringify(campaignPayload),
          isScheduled ? scheduledAt : null,
        ]
      );

      const campaignId = campaignResult.rows[0].id;

      if (!isScheduled) {
        setImmediate(() => runCampaignSendJob(query, { campaignId, ...campaignPayload }));
      }

      auditLog(query, {
        req,
        event_type: AuditEvent.CAMPAIGN_CREATED,
        message: isScheduled
          ? `Campaña programada #${campaignId} (${tRow.name}, ${recipients.length} destinatarios)`
          : `Campaña en cola #${campaignId} (${tRow.name}, ${recipients.length} destinatarios)`,
        meta: {
          campaign_id: campaignId,
          area,
          status: campaignStatus,
          template_name: tRow.name,
          segments,
          audience_mode: audienceMode,
          total_recipients: recipients.length,
          is_scheduled: isScheduled,
          scheduled_at: isScheduled && scheduledAt ? scheduledAt.toISOString() : null,
        },
      });

      const dest = appPath(`/campaigns/${campaignId}`);
      if (wantsJson) {
        return res.json({ ok: true, redirect: dest, campaignId });
      }
      res.redirect(dest);
    } catch (error) {
      logError(req, 'Error en envio de campana', error);
      if (wantsJson) {
        return res.status(500).json({ ok: false, error: error.message || 'Error al enviar' });
      }
      res.status(500).send(`No se pudo enviar la campaña: ${error.message}`);
    }
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
