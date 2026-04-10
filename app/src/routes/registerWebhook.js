const { logError, logWarn, logInfo } = require('../utils/logger');
const { verifyWebhookSignature } = require('../middleware/webhookVerify');
const { persistInboundMessagesFromWebhookValue } = require('../services/webhookInbound');
const { getVerifyToken } = require('../services/metaSettingsCache');

function registerWebhook(app, ctx) {
  const { query } = ctx;

  app.get('/webhook', (req, res) => {
    const mode = req.query['hub.mode'];
    const token = String(req.query['hub.verify_token'] ?? '').trim();
    const challenge = req.query['hub.challenge'];
    const expected = getVerifyToken();

    if (mode === 'subscribe' && expected && token === expected) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  });

  app.post('/webhook', async (req, res) => {
    try {
      if (!verifyWebhookSignature(req)) {
        logWarn(req, 'Webhook POST: firma invalida o APP_SECRET ausente', {
          hasRawBody: Buffer.isBuffer(req.rawBody),
          rawBodyLength: Buffer.isBuffer(req.rawBody) ? req.rawBody.length : 0,
        });
        return res.status(401).json({ ok: false, error: 'Invalid webhook signature' });
      }

      const entries = req.body.entry || [];

      for (const entry of entries) {
        const changes = entry.changes || [];

        for (const change of changes) {
          const value = change.value || {};
          await persistInboundMessagesFromWebhookValue(query, value);

          const statuses = value.statuses || [];

          for (const status of statuses) {
            const messageId = status.id;
            const mappedStatus = status.status;

            if (messageId && mappedStatus) {
              await query(
                `UPDATE campaign_logs
                 SET status = $1,
                     response = COALESCE(response, '{}'::jsonb) || $2::jsonb
                 WHERE whatsapp_message_id = $3`,
                [mappedStatus, JSON.stringify(status), messageId]
              );

              await query(
                `UPDATE chat_messages
                 SET raw_payload = COALESCE(raw_payload, '{}'::jsonb) || jsonb_build_object('delivery_status', $1::jsonb)
                 WHERE wa_message_id = $2`,
                [JSON.stringify(status), messageId]
              );
            }
          }
        }
      }

      logInfo(req, 'Webhook POST procesado', {
        entries: Array.isArray(req.body.entry) ? req.body.entry.length : 0,
      });

      res.sendStatus(200);
    } catch (error) {
      logError(req, 'Error procesando webhook', error);
      res.status(500).json({ ok: false, error: error.message });
    }
  });
}

module.exports = { registerWebhook };
