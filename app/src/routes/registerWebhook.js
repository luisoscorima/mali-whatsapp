const { logError, logWarn, logInfo } = require('../utils/logger');
const { verifyWebhookSignature } = require('../middleware/webhookVerify');
const {
  persistInboundMessagesFromWebhookValue,
  resolveInboundArea,
} = require('../services/webhookInbound');
const { getVerifyToken } = require('../services/metaSettingsCache');

function registerWebhook(app, ctx) {
  const { query, config } = ctx;
  const webhookRoutes = Array.from(
    new Set(['/webhook', config.basePath ? `${config.basePath}/webhook` : ''])
  ).filter(Boolean);

  const handleVerify = (req, res) => {
    const mode = req.query['hub.mode'];
    const token = String(req.query['hub.verify_token'] ?? '').trim();
    const challenge = req.query['hub.challenge'];
    const expected = getVerifyToken();

    logInfo(req, 'Webhook GET verificacion recibida', {
      path: req.path,
      hasExpectedToken: Boolean(expected),
      mode: mode || null,
    });

    if (mode === 'subscribe' && expected && token === expected) {
      return res.status(200).send(challenge);
    }

    return res.sendStatus(403);
  };

  const handleWebhookPost = async (req, res) => {
    try {
      logInfo(req, 'Webhook POST recibido', {
        path: req.path,
        bodyObject: req.body?.object || null,
        hasEntry: Array.isArray(req.body?.entry),
      });

      if (!verifyWebhookSignature(req)) {
        logWarn(req, 'Webhook POST: firma invalida o APP_SECRET ausente', {
          hasRawBody: Buffer.isBuffer(req.rawBody),
          rawBodyLength: Buffer.isBuffer(req.rawBody) ? req.rawBody.length : 0,
        });
        return res.status(401).json({ ok: false, error: 'Invalid webhook signature' });
      }

      const webhookDebug =
        String(process.env.WEBHOOK_DEBUG || '').trim().toLowerCase() === 'true';

      const entries = req.body.entry || [];

      if (webhookDebug) {
        for (const entry of entries) {
          for (const change of entry.changes || []) {
            const v = change.value || {};
            logInfo(req, 'Webhook DEBUG estructura (sin cuerpo del mensaje)', {
              bodyObject: req.body.object || null,
              entryId: entry.id || null,
              field: change.field || null,
              valueKeys: Object.keys(v),
              metadataKeys: v.metadata && typeof v.metadata === 'object' ? Object.keys(v.metadata) : [],
              metadataPhoneNumberId: v.metadata?.phone_number_id ?? null,
              messagesCount: Array.isArray(v.messages) ? v.messages.length : 0,
              statusesCount: Array.isArray(v.statuses) ? v.statuses.length : 0,
            });
          }
        }
      }

      for (const entry of entries) {
        const changes = entry.changes || [];
        const wabaEntryId = entry.id;

        for (const change of changes) {
          if (change.field === 'message_template_status_update') {
            const v = change.value || {};
            const templateName = String(v.message_template_name || v.name || '').trim();
            const templateLanguage = String(v.message_template_language || v.language || '').trim();
            const event = String(v.event || v.message_template_status || '').trim().toUpperCase();
            const reason = v.reason || v.rejection_reason || null;
            if (templateName && event) {
              const { area } = resolveInboundArea({}, wabaEntryId);
              if (!area) {
                logWarn(req, 'Webhook plantilla: no se pudo resolver area', {
                  templateName,
                  wabaEntryId: wabaEntryId || null,
                });
              } else {
                await query(
                  `UPDATE whatsapp_templates
                   SET status = $1,
                       rejection_reason = $2,
                       synced_at = NOW()
                   WHERE area = $3 AND name = $4 AND ($5 = '' OR language = $5)`,
                  [
                    event,
                    reason ? String(reason) : null,
                    area,
                    templateName,
                    templateLanguage,
                  ]
                );
              }
            }
            continue;
          }

          const value = change.value || {};
          const inboundCount = Array.isArray(value.messages) ? value.messages.length : 0;
          if (inboundCount > 0) {
            logInfo(req, 'Webhook: mensajes entrantes (Meta)', {
              entryId: wabaEntryId || null,
              field: change.field || null,
              metadataPhoneNumberId: value.metadata?.phone_number_id ?? null,
              messagesCount: inboundCount,
            });
          }
          await persistInboundMessagesFromWebhookValue(query, value, {
            wabaEntryId,
            field: change.field,
          });

          const statuses = value.statuses || [];

          for (const status of statuses) {
            const messageId = status.id;
            const mappedStatus = String(status.status || '')
              .trim()
              .toLowerCase();

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
  };

  for (const route of webhookRoutes) {
    app.get(route, handleVerify);
    app.post(route, handleWebhookPost);
  }
}

module.exports = { registerWebhook };
