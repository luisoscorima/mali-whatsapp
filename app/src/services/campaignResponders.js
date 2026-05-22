const { sqlCampaignLogIsSalidaOk } = require('../utils/campaignLogStatuses');

/** Ventana fija v1: respuesta inbound dentro de N días posteriores al envío (campaign_log.created_at). */
const RESPONSE_WINDOW_DAYS = 7;

function mapResponderRow(row) {
  return {
    phone: row.phone,
    contactName: row.contact_name || '',
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    firstResponseAt: row.first_response_at,
  };
}

function buildRespondedPct(respondedCount, salidaOkCount) {
  if (!salidaOkCount || salidaOkCount <= 0) return null;
  return Math.round((respondedCount / salidaOkCount) * 100);
}

async function fetchCampaignSalidaOkCount(query, campaignId, area) {
  const r = await query(
    `SELECT COUNT(*)::int AS n
     FROM campaign_logs cl
     JOIN campaigns c ON c.id = cl.campaign_id
     WHERE cl.campaign_id = $1
       AND c.area = $2
       AND ${sqlCampaignLogIsSalidaOk('cl.status')}`,
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
    `SELECT
       cl.phone,
       COALESCE(ct.name, '') AS contact_name,
       COALESCE(cl.contact_id, conv.contact_id) AS contact_id,
       conv.id AS conversation_id,
       MIN(cm.created_at) AS first_response_at
     FROM campaign_logs cl
     JOIN campaigns c ON c.id = cl.campaign_id AND c.area = $2
     INNER JOIN conversations conv ON conv.area = c.area AND conv.phone = cl.phone
     INNER JOIN chat_messages cm ON cm.conversation_id = conv.id
       AND cm.direction = 'inbound'
       AND cm.created_at > cl.created_at
       AND cm.created_at <= cl.created_at + INTERVAL '${RESPONSE_WINDOW_DAYS} days'
     LEFT JOIN contacts ct ON ct.id = COALESCE(cl.contact_id, conv.contact_id)
     WHERE cl.campaign_id = $1
       AND ${sqlCampaignLogIsSalidaOk('cl.status')}
     GROUP BY cl.phone, ct.name, cl.contact_id, conv.contact_id, conv.id
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
    salidaOkCount,
    respondedCount,
    respondedPct: buildRespondedPct(respondedCount, salidaOkCount),
    responders,
  };
}

module.exports = {
  RESPONSE_WINDOW_DAYS,
  fetchCampaignResponders,
  fetchCampaignResponderMetrics,
  fetchCampaignSalidaOkCount,
  buildRespondedPct,
};
