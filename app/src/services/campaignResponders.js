const config = require('../config');
const { sqlCampaignLogIsSalidaOk } = require('../utils/campaignLogStatuses');

/** Ventana fija v1: respuesta inbound dentro de N días posteriores al envío (campaign_log.created_at). */
const RESPONSE_WINDOW_DAYS = config.CAMPAIGN_RESPONSE_WINDOW_DAYS;

function mapResponderRow(row) {
  return {
    phone: row.phone,
    contactName: row.contact_name || '',
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    firstResponseAt: row.first_response_at,
  };
}

async function fetchCampaignSalidaOkCount(query, campaignId, area) {
  const r = await query(
    `SELECT COUNT(*)::int AS n
     FROM (
       SELECT DISTINCT ON (cl.phone)
         cl.phone,
         cl.status
       FROM campaign_logs cl
       JOIN campaigns c ON c.id = cl.campaign_id
       WHERE cl.campaign_id = $1
         AND c.area = $2
       ORDER BY cl.phone, cl.id DESC
     ) latest_logs
     WHERE ${sqlCampaignLogIsSalidaOk('latest_logs.status')}`,
    [campaignId, area]
  );
  return r.rows[0]?.n ?? 0;
}

/**
 * Contactos con al menos un mensaje inbound en la conversación del teléfono,
 * entre el envío (log salida OK) y +7 días. Una fila por teléfono (primera respuesta).
 */
async function fetchCampaignResponders(query, campaignId, area) {
  const r = await query(
    `WITH latest_logs AS (
       SELECT DISTINCT ON (cl.phone)
         cl.phone,
         cl.contact_id,
         cl.created_at,
         cl.status
       FROM campaign_logs cl
       JOIN campaigns c ON c.id = cl.campaign_id AND c.area = $2
       WHERE cl.campaign_id = $1
       ORDER BY cl.phone, cl.id DESC
     )
     SELECT
       latest_logs.phone,
       COALESCE(ct.name, '') AS contact_name,
       COALESCE(latest_logs.contact_id, conv.contact_id) AS contact_id,
       conv.id AS conversation_id,
       MIN(cm.created_at) AS first_response_at
     FROM latest_logs
     INNER JOIN conversations conv ON conv.area = $2 AND conv.phone = latest_logs.phone
     INNER JOIN chat_messages cm ON cm.conversation_id = conv.id
       AND cm.direction = 'inbound'
       AND cm.created_at > latest_logs.created_at
       AND cm.created_at <= latest_logs.created_at + INTERVAL '${RESPONSE_WINDOW_DAYS} days'
     LEFT JOIN contacts ct ON ct.id = COALESCE(latest_logs.contact_id, conv.contact_id)
     WHERE ${sqlCampaignLogIsSalidaOk('latest_logs.status')}
     GROUP BY latest_logs.phone, ct.name, latest_logs.contact_id, conv.contact_id, conv.id
     ORDER BY first_response_at DESC`,
    [campaignId, area]
  );
  return r.rows.map(mapResponderRow);
}

async function fetchCampaignResponderMetrics(query, campaignId, area) {
  const [salidaOkCount, responders] = await Promise.all([
    fetchCampaignSalidaOkCount(query, campaignId, area),
    fetchCampaignResponders(query, campaignId, area),
  ]);
  const respondedCount = responders.length;
  return {
    windowDays: RESPONSE_WINDOW_DAYS,
    sentCount: salidaOkCount,
    respondedCount,
    responders,
  };
}

module.exports = {
  RESPONSE_WINDOW_DAYS,
  fetchCampaignResponders,
  fetchCampaignResponderMetrics,
  fetchCampaignSalidaOkCount,
};
