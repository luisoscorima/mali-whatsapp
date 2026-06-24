const config = require('../config');
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
const { buildCampaignMessagePreview } = require('./campaignMessagePreview');
const { normalizeArea } = require('../middleware/auth');
const { fetchRecipientsUnion, validateRecipientsMatchRequest } = require('./campaignRecipients');
const { mergeCampaignExcludeContactIds } = require('./exclusionLists');
const { classifyCampaignSendError } = require('../utils/campaignSendErrorClassify');
const {
  fetchContactAttributesMap,
  buildParamsForContact,
} = require('./contactTemplateParams');
const { runCampaignRetryJob, promoteDueCampaignRetries } = require('./campaignRetry');

const fakeReqLog = {
  path: '/campaigns/async',
  method: 'POST',
  get: () => '',
};

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function buildCampaignRecipients(query, area, ctx) {
  const recipientOptions = {};
  let mergedExclude =
    Array.isArray(ctx.excludeContactIdsMerged) && ctx.excludeContactIdsMerged.length > 0
      ? ctx.excludeContactIdsMerged
      : null;
  if (!mergedExclude) {
    const excludeMerge = await mergeCampaignExcludeContactIds(
      query,
      area,
      {
        excludeContactIds: ctx.excludeContactIds || [],
        excludeListIds: ctx.excludeListIds || [],
      },
      config.CAMPAIGN_MAX_RECIPIENT_IDS
    );
    mergedExclude = excludeMerge.ok ? excludeMerge.ids : [];
  }
  if (mergedExclude.length > 0) {
    recipientOptions.excludeContactIds = mergedExclude;
  }
  if (Array.isArray(ctx.excludeSegmentSlugs) && ctx.excludeSegmentSlugs.length > 0) {
    recipientOptions.excludeSegmentSlugs = ctx.excludeSegmentSlugs;
  }

  if (
    Array.isArray(ctx.recipientContactIds) &&
    ctx.recipientContactIds.length > 0 &&
    Array.isArray(ctx.segments) &&
    ctx.segments.length > 0
  ) {
    const recipients = await fetchRecipientsUnion(query, area, ctx.segments, {
      ...recipientOptions,
      contactIds: ctx.recipientContactIds,
    });
    if (!validateRecipientsMatchRequest(recipients, ctx.recipientContactIds)) {
      throw new Error('Destinatarios de campaña inválidos o fuera de segmentos');
    }
    return recipients;
  }
  if (ctx.segment) {
    return fetchRecipientsUnion(query, area, [ctx.segment], recipientOptions);
  }
  if (Array.isArray(ctx.segments) && ctx.segments.length > 0) {
    return fetchRecipientsUnion(query, area, ctx.segments, recipientOptions);
  }
  throw new Error('Payload de campaña inválido: falta segmento o lista de destinatarios');
}

async function fetchProcessedRecipientState(query, campaignId) {
  const r = await query(
    `SELECT contact_id, phone
     FROM campaign_logs
     WHERE campaign_id = $1`,
    [campaignId]
  );
  const contactIds = new Set();
  const phones = new Set();
  for (const row of r.rows) {
    if (Number.isInteger(row.contact_id) && row.contact_id > 0) {
      contactIds.add(row.contact_id);
    }
    if (row.phone) {
      phones.add(normalizePhone(row.phone));
    }
  }
  return { contactIds, phones };
}

function filterPendingRecipients(recipients, processedState) {
  return recipients.filter((contact) => {
    if (processedState.contactIds.has(contact.id)) return false;
    const phoneNorm = normalizePhone(contact.phone);
    if (phoneNorm && processedState.phones.has(phoneNorm)) return false;
    return true;
  });
}

/**
 * @param {object} ctx - campaign_payload deserializado + campaignId
 */
async function runCampaignSendJob(query, ctx) {
  const {
    campaignId,
    area: areaRaw,
    templateSnapshot,
    staticParams,
    paramMapping,
    batchSize,
    batchDelayMs,
  } = ctx;
  const area = normalizeArea(areaRaw);

  const row = {
    id: templateSnapshot.id || 0,
    name: templateSnapshot.name,
    language: templateSnapshot.language,
    category: templateSnapshot.category || '',
    status: 'APPROVED',
    components_json: templateSnapshot.components_json,
  };
  const def = buildTemplateDefinition(row);
  const usePerContactParams = Boolean(paramMapping);

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

    const allRecipients = await buildCampaignRecipients(query, area, ctx);
    await query(`UPDATE campaigns SET total_recipients = $1 WHERE id = $2`, [allRecipients.length, campaignId]);
    const processedState = await fetchProcessedRecipientState(query, campaignId);
    const recipients = filterPendingRecipients(allRecipients, processedState);
    const alreadyProcessed = allRecipients.length - recipients.length;
    if (alreadyProcessed > 0) {
      logInfo(fakeReqLog, 'Campana reanudada sin duplicados', {
        campaignId,
        totalRecipients: allRecipients.length,
        pendingRecipients: recipients.length,
        alreadyProcessed,
      });
    }

    let attrsMap = new Map();
    if (usePerContactParams) {
      attrsMap = await fetchContactAttributesMap(
        query,
        recipients.map((c) => c.id)
      );
    }

    for (let i = 0; i < recipients.length; i += batchSize) {
      const batch = recipients.slice(i, i + batchSize);

      for (const contact of batch) {
        try {
          const phoneNorm = normalizePhone(contact.phone);
          const gapMs = Number(config.CAMPAIGN_PHONE_MIN_GAP_MS) || 0;
          if (gapMs > 0) {
            const lastR = await query(
              `SELECT MAX(created_at) AS t FROM campaign_logs WHERE phone = $1`,
              [phoneNorm]
            );
            const lastT = lastR.rows[0]?.t;
            if (lastT) {
              const elapsed = Date.now() - new Date(lastT).getTime();
              if (elapsed < gapMs) {
                await wait(gapMs - elapsed);
              }
            }
          }

          const resolvedParams = usePerContactParams
            ? buildParamsForContact(
                staticParams,
                paramMapping,
                contact,
                attrsMap.get(contact.id)
              )
            : staticParams;
          const components = buildWhatsappGraphComponents(def, resolvedParams);

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
              phoneNorm,
              messageId,
              'sent',
              JSON.stringify(sanitizeApiResponse(apiResponse)),
            ]
          );

          try {
            const { preview } = buildCampaignMessagePreview(
              def,
              templateSnapshot.components_json,
              resolvedParams
            );
            await upsertCampaignChatMessage(query, {
              area,
              campaignId,
              templateName: templateSnapshot.name,
              phone: contact.phone,
              contactId: contact.id,
              waMessageId: messageId,
              preview,
            });
          } catch (chatErr) {
            logError(fakeReqLog, 'No se pudo registrar campaña en conversación', chatErr, {
              campaignId,
              contactId: contact.id,
            });
          }
        } catch (error) {
          const payload = sanitizeApiErrorPayload(error.response?.data || { message: error.message });
          const { retryable } = classifyCampaignSendError(payload);

          await query(
            `INSERT INTO campaign_logs (campaign_id, contact_id, phone, status, response, retryable, attempt)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, 1)`,
            [
              campaignId,
              contact.id,
              normalizePhone(contact.phone),
              'error',
              JSON.stringify(payload),
              retryable,
            ]
          );
          logError(fakeReqLog, 'Error enviando mensaje (async)', error, { campaignId, contactId: contact.id });
        }
      }

      if (i + batchSize < recipients.length) {
        await wait(batchDelayMs);
      }
    }

    await query(
      `UPDATE campaigns
       SET status = 'completed',
           auto_retry_at = NOW() + ($2::int * interval '1 minute'),
           auto_retry_done = FALSE
       WHERE id = $1`,
      [campaignId, config.CAMPAIGN_AUTO_RETRY_DELAY_MINUTES]
    );
    logInfo(fakeReqLog, 'Campana completada', {
      campaignId,
      totalRecipients: allRecipients.length,
      processedNow: recipients.length,
    });
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

async function resumeInterruptedCampaigns(query) {
  const r = await query(
    `SELECT id FROM campaigns WHERE status = 'processing' ORDER BY id ASC`
  );
  for (const row of r.rows) {
    const lock = await query(
      `UPDATE campaigns SET status = 'queued' WHERE id = $1 AND status = 'processing' RETURNING id`,
      [row.id]
    );
    if (lock.rowCount === 0) continue;
    logInfo(fakeReqLog, 'Campana interrumpida devuelta a cola', {
      campaignId: row.id,
    });
  }
}

module.exports = {
  runCampaignSendJob,
  resumeQueuedCampaigns,
  resumeInterruptedCampaigns,
  promoteDueScheduledCampaigns,
  runCampaignRetryJob,
  promoteDueCampaignRetries,
  wait,
};
