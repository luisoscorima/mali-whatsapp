const axios = require('axios');
const config = require('../config');
const { getWhatsAppCredentialsForArea } = require('./metaSettingsCache');
const { resolveWabaId } = require('./metaWhatsApp');
const { sqlCampaignLogIsSalidaOk } = require('../utils/campaignLogStatuses');

/**
 * Cuenta destinatarios con envio vigente aceptado por Meta.
 */
async function countDeliveredOkLogs(query, campaignId) {
  const r = await query(
    `SELECT COUNT(*)::int AS n
     FROM (
       SELECT DISTINCT ON (phone)
         phone,
         status
       FROM campaign_logs
       WHERE campaign_id = $1
       ORDER BY phone, id DESC
     ) latest_logs
     WHERE ${sqlCampaignLogIsSalidaOk('latest_logs.status')}`,
    [campaignId]
  );
  return r.rows[0]?.n ?? 0;
}

async function getCostPerMessageEstimate(query, area) {
  const r = await query(
    `SELECT value FROM app_settings WHERE area = $1 AND key = 'campaign_cost_per_message_usd'`,
    [area]
  );
  if (r.rowCount === 0) return config.CAMPAIGN_COST_PER_MESSAGE_USD_DEFAULT;
  const n = Number(r.rows[0].value);
  return Number.isFinite(n) && n >= 0 ? n : config.CAMPAIGN_COST_PER_MESSAGE_USD_DEFAULT;
}

/**
 * Intenta obtener costo desde template_analytics del WABA en ventana de la campaña.
 */
async function fetchTemplateAnalyticsCost({ area, templateName, startUnix, endUnix }) {
  const { token, phoneNumberId } = getWhatsAppCredentialsForArea(area);
  if (!token || !phoneNumberId) {
    return null;
  }
  const wabaId = await resolveWabaId(area, token, phoneNumberId);
  const url = `${config.GRAPH_BASE}/${wabaId}/template_analytics`;
  const params = {
    start: startUnix,
    end: endUnix,
    granularity: 'DAILY',
    metric_types: 'COST,CLICKS,DELIVERED',
    template_ids: JSON.stringify([]),
  };
  try {
    const { data } = await axios.get(url, {
      params: {
        ...params,
        template_ids: undefined,
      },
      headers: { Authorization: `Bearer ${token}` },
    });
    const points = data?.data?.[0]?.data_points;
    if (!Array.isArray(points)) return null;
    let totalCost = 0;
    let currency = 'USD';
    for (const p of points) {
      if (String(p.template_name || '').toLowerCase() !== String(templateName || '').toLowerCase()) {
        continue;
      }
      const c = Number(p.cost);
      if (Number.isFinite(c)) totalCost += c;
      if (p.cost_currency) currency = String(p.cost_currency);
    }
    if (totalCost <= 0) return null;
    return { amount: totalCost, currency, source: 'template_analytics' };
  } catch {
    return null;
  }
}

/**
 * Sincroniza costo de campaña: API Meta si responde; si no, estimado por envios vigentes.
 */
async function syncCampaignCost(query, { campaignId, area }) {
  const campR = await query(
    `SELECT id, template_name, created_at, status FROM campaigns WHERE id = $1 AND area = $2`,
    [campaignId, area]
  );
  if (campR.rowCount === 0) {
    return { ok: false, error: 'Campaña no encontrada' };
  }
  const campaign = campR.rows[0];
  const deliveredOk = await countDeliveredOkLogs(query, campaignId);

  const start = new Date(campaign.created_at);
  const end = new Date();
  const startUnix = Math.floor(start.getTime() / 1000);
  const endUnix = Math.floor(end.getTime() / 1000) + 86400;

  let amount = null;
  let currency = 'USD';
  let source = 'estimated';
  let isEstimated = true;

  const fromApi = await fetchTemplateAnalyticsCost({
    area,
    templateName: campaign.template_name,
    startUnix,
    endUnix,
  });
  if (fromApi && fromApi.amount > 0) {
    amount = fromApi.amount;
    currency = fromApi.currency || 'USD';
    source = fromApi.source;
    isEstimated = false;
  } else {
    const rate = await getCostPerMessageEstimate(query, area);
    amount = deliveredOk * rate;
    source = 'estimated_sent';
    isEstimated = true;
  }

  await query(
    `UPDATE campaigns
     SET cost_amount = $1,
         cost_currency = $2,
         cost_synced_at = NOW(),
         cost_source = $3,
         cost_is_estimated = $4
     WHERE id = $5`,
    [amount, currency, source, isEstimated, campaignId]
  );

  return {
    ok: true,
    amount,
    currency,
    source,
    isEstimated,
    deliveredOk,
  };
}

module.exports = {
  syncCampaignCost,
  countDeliveredOkLogs,
};
