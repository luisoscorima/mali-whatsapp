const { logInfo, logError } = require('../utils/logger');
const { sanitizeApiResponse, sanitizeApiErrorPayload } = require('../utils/apiSanitize');
const { normalizePhone } = require('../utils/phone');
const { sendTemplateWithComponents } = require('./metaWhatsApp');
const { getWhatsAppCredentialsForArea } = require('./metaSettingsCache');
const {
  buildTemplateDefinition,
  buildWhatsappGraphComponents,
} = require('./templateParser');
const { upsertCampaignChatMessage } = require('./campaignConversationLog');

const fakeReqLog = {
  path: '/campaigns/async',
  method: 'POST',
  get: () => '',
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * @param {object} ctx - campaign_payload deserializado + campaignId
 */
async function runCampaignSendJob(query, ctx) {
  const {
    campaignId,
    area,
    segment,
    templateSnapshot,
    staticParams,
    batchSize,
    batchDelayMs,
  } = ctx;

  const row = {
    id: templateSnapshot.id || 0,
    name: templateSnapshot.name,
    language: templateSnapshot.language,
    category: templateSnapshot.category || '',
    status: 'APPROVED',
    components_json: templateSnapshot.components_json,
  };
  const def = buildTemplateDefinition(row);
  const components = buildWhatsappGraphComponents(def, staticParams);

  try {
    const lock = await query(
      `UPDATE campaigns SET status = 'processing' WHERE id = $1 AND status = 'queued' RETURNING id`,
      [campaignId]
    );
    if (lock.rowCount === 0) {
      return;
    }

    const creds = getWhatsAppCredentialsForArea(area);
    logInfo(fakeReqLog, 'Campana: envio con Phone Number ID', {
      campaignId,
      area,
      phoneNumberId: creds.phoneNumberId || null,
    });

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

    await query(`UPDATE campaigns SET total_recipients = $1 WHERE id = $2`, [recipients.length, campaignId]);

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      for (const contact of batch) {
        try {
          const apiResponse = await sendTemplateWithComponents({
            to: normalizePhone(contact.phone),
            templateName: templateSnapshot.name,
            languageCode: templateSnapshot.language,
            components,
            area,
          });

          const messageId = apiResponse.messages?.[0]?.id || null;

          // response: respuesta de la API Meta al enviar; estados posteriores se fusionan desde el webhook.
          await query(
            `INSERT INTO campaign_logs (campaign_id, contact_id, phone, whatsapp_message_id, status, response)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
            [
              campaignId,
              contact.id,
              normalizePhone(contact.phone),
              messageId,
              'sent',
              JSON.stringify(sanitizeApiResponse(apiResponse)),
            ]
          );

          try {
            await upsertCampaignChatMessage(query, {
              area,
              campaignId,
              templateName: templateSnapshot.name,
              phone: contact.phone,
              contactId: contact.id,
              waMessageId: messageId,
            });
          } catch (chatErr) {
            logError(fakeReqLog, 'No se pudo registrar campaña en conversación', chatErr, {
              campaignId,
              contactId: contact.id,
            });
          }
        } catch (error) {
          const payload = sanitizeApiErrorPayload(error.response?.data || { message: error.message });

          await query(
            `INSERT INTO campaign_logs (campaign_id, contact_id, phone, status, response)
             VALUES ($1, $2, $3, $4, $5::jsonb)`,
            [campaignId, contact.id, normalizePhone(contact.phone), 'error', JSON.stringify(payload)]
          );
          logError(fakeReqLog, 'Error enviando mensaje (async)', error, { campaignId, contactId: contact.id });
        }
      }

      if (i + batchSize < recipients.length) {
        await wait(batchDelayMs);
      }
    }

    await query(`UPDATE campaigns SET status = 'completed' WHERE id = $1`, [campaignId]);
    logInfo(fakeReqLog, 'Campana completada', { campaignId, recipients: recipients.length });
  } catch (error) {
    try {
      await query(`UPDATE campaigns SET status = 'failed' WHERE id = $1`, [campaignId]);
    } catch {
      /* ignore */
    }
    logError(fakeReqLog, 'Error en envio de campana async', error, { campaignId });
  }
}

const PROMOTE_SCHEDULED_LIMIT = 50;

/**
 * Pasa a cola las campañas programadas cuya hora ya venció y dispara el job (idempotente por fila).
 */
async function promoteDueScheduledCampaigns(query) {
  const r = await query(
    `SELECT id, campaign_payload FROM campaigns
     WHERE status = 'scheduled' AND scheduled_at <= NOW()
     ORDER BY scheduled_at ASC
     LIMIT $1`,
    [PROMOTE_SCHEDULED_LIMIT]
  );
  for (const row of r.rows) {
    const lock = await query(
      `UPDATE campaigns SET status = 'queued' WHERE id = $1 AND status = 'scheduled' RETURNING id`,
      [row.id]
    );
    if (lock.rowCount === 0) continue;
    const p = row.campaign_payload;
    if (!p) continue;
    const payload = typeof p === 'string' ? JSON.parse(p) : p;
    setImmediate(() => runCampaignSendJob(query, { campaignId: row.id, ...payload }));
  }
}

async function resumeQueuedCampaigns(query) {
  const r = await query(
    `SELECT id, campaign_payload FROM campaigns WHERE status = 'queued' ORDER BY id ASC`
  );
  for (const row of r.rows) {
    const p = row.campaign_payload;
    if (!p) continue;
    const payload = typeof p === 'string' ? JSON.parse(p) : p;
    setImmediate(() => runCampaignSendJob(query, { campaignId: row.id, ...payload }));
  }
}

module.exports = { runCampaignSendJob, resumeQueuedCampaigns, promoteDueScheduledCampaigns, wait };
