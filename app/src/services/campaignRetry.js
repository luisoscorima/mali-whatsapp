const config = require('../config');
const { logInfo, logError } = require('../utils/logger');
const { sanitizeApiResponse, sanitizeApiErrorPayload } = require('../utils/apiSanitize');
const { normalizePhone } = require('../utils/phone');
const { sendTemplateWithComponents } = require('./metaWhatsApp');
const {
  buildTemplateDefinition,
  buildWhatsappGraphComponents,
} = require('./templateParser');
const { upsertCampaignChatMessage } = require('./campaignConversationLog');
const { normalizeArea } = require('../middleware/auth');
const { classifyCampaignSendError } = require('../utils/campaignSendErrorClassify');
const {
  fetchContactAttributesMap,
  buildParamsForContact,
} = require('./contactTemplateParams');
const { sqlNoSuccessfulLogForPhone } = require('./campaignFailedLogs');
const {
  SALIDA_OK_STATUSES,
  sqlCampaignLogIsError,
  campaignLogStatusColumnSql,
  sqlInList,
} = require('../utils/campaignLogStatuses');
const fakeReqLog = {
  path: '/campaigns/retry',
  method: 'POST',
  get: () => '',
};

const PROMOTE_RETRY_LIMIT = 50;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const SALIDA_OK_IN = sqlInList(SALIDA_OK_STATUSES);

function parseCampaignPayload(raw) {
  if (!raw) return null;
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

function buildSendContext(payload) {
  const templateSnapshot = payload.templateSnapshot;
  if (!templateSnapshot) return null;
  const row = {
    id: templateSnapshot.id || 0,
    name: templateSnapshot.name,
    language: templateSnapshot.language,
    category: templateSnapshot.category || '',
    status: 'APPROVED',
    components_json: templateSnapshot.components_json,
  };
  const def = buildTemplateDefinition(row);
  return {
    area: normalizeArea(payload.area),
    templateSnapshot,
    def,
    staticParams: payload.staticParams || {},
    paramMapping: payload.paramMapping || null,
    batchDelayMs: Number(payload.batchDelayMs) || 0,
  };
}

function buildComponentsForRetry(sendCtx, contact, attrsMap) {
  const { def, staticParams, paramMapping } = sendCtx;
  if (paramMapping && contact) {
    const resolved = buildParamsForContact(
      staticParams,
      paramMapping,
      contact,
      attrsMap.get(contact.id)
    );
    return buildWhatsappGraphComponents(def, resolved);
  }
  return buildWhatsappGraphComponents(def, staticParams);
}

/**
 * Candidatos a reintento: fallidos, retryable, bajo máximo de intentos y sin éxito previo en la campaña.
 */
async function fetchRetryCandidates(query, campaignId, maxAttempts) {
  const r = await query(
    `SELECT cl.id, cl.contact_id, cl.phone, cl.attempt
     FROM campaign_logs cl
     WHERE cl.campaign_id = $1
       AND ${sqlCampaignLogIsError('cl.status')}
       AND cl.retryable = TRUE
       AND COALESCE(cl.attempt, 1) < $2
       AND NOT EXISTS (
         SELECT 1 FROM campaign_logs ok
         WHERE ok.campaign_id = cl.campaign_id
           AND ok.phone = cl.phone
           AND ok.id <> cl.id
           AND ${campaignLogStatusColumnSql('ok.status')} IN ${SALIDA_OK_IN}
       )
     ORDER BY cl.id ASC`,
    [campaignId, maxAttempts]
  );
  return r.rows;
}

async function fetchCampaignRetryStats(query, campaignId) {
  const okStatus = campaignLogStatusColumnSql('status');
  const r = await query(
    `SELECT
       COALESCE(SUM(CASE WHEN ${okStatus} IN ${SALIDA_OK_IN} AND COALESCE(attempt, 1) > 1 THEN 1 ELSE 0 END), 0)::int AS recovered_count,
       COALESCE(SUM(CASE WHEN ${sqlCampaignLogIsError('status')} AND ${sqlNoSuccessfulLogForPhone()} THEN 1 ELSE 0 END), 0)::int AS failed_count
     FROM campaign_logs
     WHERE campaign_id = $1`,
    [campaignId]
  );
  const campaignR = await query(
    `SELECT status, auto_retry_at, auto_retry_done, manual_retry_count
     FROM campaigns WHERE id = $1`,
    [campaignId]
  );
  const row = r.rows[0] || { recovered_count: 0, failed_count: 0 };
  const campaign = campaignR.rows[0] || {};
  const status = String(campaign.status || '');
  const canManualRetry =
    row.failed_count > 0 &&
    status !== 'processing' &&
    status !== 'queued' &&
    Number(campaign.manual_retry_count || 0) < config.CAMPAIGN_MAX_MANUAL_RETRIES;
  const autoRetryPending =
    status === 'completed' &&
    !campaign.auto_retry_done &&
    campaign.auto_retry_at &&
    new Date(campaign.auto_retry_at).getTime() > Date.now();

  return {
    recoveredCount: row.recovered_count,
    failedCount: row.failed_count,
    canManualRetry,
    manualRetryCount: Number(campaign.manual_retry_count || 0),
    maxManualRetries: config.CAMPAIGN_MAX_MANUAL_RETRIES,
    autoRetryDelayMinutes: config.CAMPAIGN_AUTO_RETRY_DELAY_MINUTES,
    autoRetryPending,
    autoRetryDone: Boolean(campaign.auto_retry_done),
  };
}

/**
 * Reintenta envíos fallidos elegibles de una campaña (auto o manual).
 * @returns {{ retried: number, recovered: number, stillFailed: number, skipped?: boolean, error?: string }}
 */
async function runCampaignRetryJob(query, { campaignId, mode = 'auto' }) {
  const maxAttempts = config.CAMPAIGN_MAX_RETRY_ATTEMPTS;

  try {
    const campaignR = await query(
      `SELECT id, area, status, campaign_payload, auto_retry_done, manual_retry_count
       FROM campaigns WHERE id = $1`,
      [campaignId]
    );
    if (campaignR.rowCount === 0) {
      return { retried: 0, recovered: 0, stillFailed: 0, skipped: true, error: 'Campaña no encontrada' };
    }
    const campaign = campaignR.rows[0];
    const status = String(campaign.status || '');

    if (status === 'processing' || status === 'queued') {
      return { retried: 0, recovered: 0, stillFailed: 0, skipped: true, error: 'Campaña en envío' };
    }

    if (mode === 'auto') {
      const lock = await query(
        `UPDATE campaigns SET auto_retry_done = TRUE
         WHERE id = $1 AND auto_retry_done = FALSE AND status = 'completed'
         RETURNING id`,
        [campaignId]
      );
      if (lock.rowCount === 0) {
        return { retried: 0, recovered: 0, stillFailed: 0, skipped: true };
      }
    } else if (Number(campaign.manual_retry_count || 0) >= config.CAMPAIGN_MAX_MANUAL_RETRIES) {
      return {
        retried: 0,
        recovered: 0,
        stillFailed: 0,
        skipped: true,
        error: `Límite de reintentos manuales (${config.CAMPAIGN_MAX_MANUAL_RETRIES})`,
      };
    }

    const payload = parseCampaignPayload(campaign.campaign_payload);
    const sendCtx = buildSendContext(payload);
    if (!sendCtx) {
      return { retried: 0, recovered: 0, stillFailed: 0, skipped: true, error: 'Payload de campaña inválido' };
    }

    const candidates = await fetchRetryCandidates(query, campaignId, maxAttempts);
    const contactIds = candidates.map((c) => c.contact_id).filter(Boolean);
    const contactRows =
      contactIds.length > 0
        ? (
            await query(
              `SELECT id, name, phone FROM contacts WHERE id = ANY($1::int[])`,
              [contactIds]
            )
          ).rows
        : [];
    const contactById = new Map(contactRows.map((c) => [c.id, c]));
    const attrsMap =
      sendCtx.paramMapping && contactIds.length > 0
        ? await fetchContactAttributesMap(query, contactIds)
        : new Map();

    if (candidates.length === 0) {
      if (mode === 'manual') {
        await query(
          `UPDATE campaigns SET manual_retry_count = manual_retry_count + 1, last_manual_retry_at = NOW() WHERE id = $1`,
          [campaignId]
        );
      }
      return { retried: 0, recovered: 0, stillFailed: 0 };
    }

    const retryDelayMs = Math.max(0, Number(sendCtx.batchDelayMs) * 2);
    let recovered = 0;
    let stillFailed = 0;

    logInfo(fakeReqLog, 'Reintento de campaña', {
      campaignId,
      mode,
      candidates: candidates.length,
    });

    for (const row of candidates) {
      if (retryDelayMs > 0) {
        await wait(retryDelayMs);
      }

      const phoneNorm = normalizePhone(row.phone);
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

      const nextAttempt = Number(row.attempt || 1) + 1;

      try {
        const contact = row.contact_id ? contactById.get(row.contact_id) : null;
        const components = buildComponentsForRetry(
          sendCtx,
          contact || { id: row.contact_id, name: '', phone: row.phone },
          attrsMap
        );
        const apiResponse = await sendTemplateWithComponents({
          to: phoneNorm,
          templateName: sendCtx.templateSnapshot.name,
          languageCode: sendCtx.templateSnapshot.language,
          components,
          area: sendCtx.area,
        });

        const messageId = apiResponse.messages?.[0]?.id || null;

        await query(
          `UPDATE campaign_logs
           SET status = 'sent',
               whatsapp_message_id = $2,
               response = $3::jsonb,
               attempt = $4,
               retryable = TRUE,
               last_retry_at = NOW()
           WHERE id = $1`,
          [
            row.id,
            messageId,
            JSON.stringify(sanitizeApiResponse(apiResponse)),
            nextAttempt,
          ]
        );

        try {
          await upsertCampaignChatMessage(query, {
            area: sendCtx.area,
            campaignId,
            templateName: sendCtx.templateSnapshot.name,
            phone: row.phone,
            contactId: row.contact_id,
            waMessageId: messageId,
          });
        } catch (chatErr) {
          logError(fakeReqLog, 'No se pudo registrar reintento en conversación', chatErr, {
            campaignId,
            logId: row.id,
          });
        }

        recovered += 1;
      } catch (error) {
        const payloadErr = sanitizeApiErrorPayload(
          error.response?.data || { message: error.message }
        );
        const classification = classifyCampaignSendError(payloadErr);

        await query(
          `UPDATE campaign_logs
           SET status = 'error',
               response = $2::jsonb,
               attempt = $3,
               retryable = $4,
               last_retry_at = NOW()
           WHERE id = $1`,
          [row.id, JSON.stringify(payloadErr), nextAttempt, classification.retryable]
        );

        stillFailed += 1;
        logError(fakeReqLog, 'Error en reintento de campaña', error, {
          campaignId,
          logId: row.id,
          mode,
        });
      }
    }

    if (mode === 'manual') {
      await query(
        `UPDATE campaigns SET manual_retry_count = manual_retry_count + 1, last_manual_retry_at = NOW() WHERE id = $1`,
        [campaignId]
      );
    }

    logInfo(fakeReqLog, 'Reintento de campaña finalizado', {
      campaignId,
      mode,
      retried: candidates.length,
      recovered,
      stillFailed,
    });

    return {
      retried: candidates.length,
      recovered,
      stillFailed,
    };
  } catch (error) {
    logError(fakeReqLog, 'Error en job de reintento de campaña', error, { campaignId, mode });
    throw error;
  }
}

/**
 * Dispara reintentos automáticos para campañas completed cuya ventana ya venció.
 */
async function promoteDueCampaignRetries(query) {
  const r = await query(
    `SELECT id FROM campaigns
     WHERE status = 'completed'
       AND auto_retry_done = FALSE
       AND auto_retry_at IS NOT NULL
       AND auto_retry_at <= NOW()
     ORDER BY auto_retry_at ASC
     LIMIT $1`,
    [PROMOTE_RETRY_LIMIT]
  );

  for (const row of r.rows) {
    setImmediate(() => {
      runCampaignRetryJob(query, { campaignId: row.id, mode: 'auto' }).catch((err) => {
        logError(fakeReqLog, 'promoteDueCampaignRetries job', err, { campaignId: row.id });
      });
    });
  }
}

module.exports = {
  runCampaignRetryJob,
  promoteDueCampaignRetries,
  fetchCampaignRetryStats,
  fetchRetryCandidates,
};
