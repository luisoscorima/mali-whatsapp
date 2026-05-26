const config = require('../config');
const { estimateCategoryCost, getCampaignTemplateCategory } = require('../utils/campaignPricing');

/**
 * Cuenta destinatarios cuya última traza ya quedó en delivered/read.
 */
async function countDeliveredLogs(query, campaignId) {
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
     WHERE LOWER(TRIM(COALESCE(latest_logs.status, ''))) IN ('delivered', 'read')`,
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
 * Sincroniza costo de campaña usando la tarifa oficial de WhatsApp por categoría.
 */
async function syncCampaignCost(query, { campaignId, area }) {
  const campR = await query(
    `SELECT id, template_name, created_at, status, campaign_payload FROM campaigns WHERE id = $1 AND area = $2`,
    [campaignId, area]
  );
  if (campR.rowCount === 0) {
    return { ok: false, error: 'Campaña no encontrada' };
  }
  const campaign = campR.rows[0];
  const deliveredCount = await countDeliveredLogs(query, campaignId);
  const category = getCampaignTemplateCategory(campaign);

  let amount = null;
  let currency = 'USD';
  let source = 'estimated';
  let isEstimated = true;

  const categoryEstimate = estimateCategoryCost(deliveredCount, category);
  if (categoryEstimate) {
    amount = categoryEstimate.usdAmount;
    currency = 'USD';
    source = 'category_rate';
    isEstimated = false;
  } else {
    const rate = await getCostPerMessageEstimate(query, area);
    amount = deliveredCount * rate;
    source = 'estimated_delivered';
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
    deliveredCount,
    category,
  };
}

module.exports = {
  syncCampaignCost,
  countDeliveredLogs,
};
