const config = require('../config');
const { sqlCampaignLogIsSalidaOk } = require('../utils/campaignLogStatuses');
const { sqlContactSegmentLabels } = require('../utils/campaignExportContactMeta');

/** Ventana fija v1: respuesta inbound dentro de N días posteriores al envío (campaign_log.created_at). */
const RESPONSE_WINDOW_DAYS = config.CAMPAIGN_RESPONSE_WINDOW_DAYS;

/** Texto del clic en botón de plantilla (body_text o raw_payload de Meta). */
const SQL_INTERACTIVE_RESPONSE_TEXT = `NULLIF(TRIM(COALESCE(
  NULLIF(TRIM(cm.body_text), '[Interactivo]'),
  NULLIF(TRIM(cm.body_text), '[Botón]'),
  NULLIF(TRIM(cm.raw_payload->'button'->>'text'), ''),
  NULLIF(TRIM(cm.raw_payload->'interactive'->'button_reply'->>'title'), '')
)), '')`;

const SQL_IS_INTERACTIVE_INBOUND = `(
  cm.message_type = 'button'
  OR (
    cm.message_type = 'interactive'
    AND COALESCE(cm.raw_payload->'interactive'->>'type', '') = 'button_reply'
  )
)`;

function mapResponderRow(row) {
  return {
    phone: row.phone,
    contactName: row.contact_name || '',
    segmentLabels: row.segment_labels || '',
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    firstResponseAt: row.first_response_at,
  };
}

function mapInteractiveResponderRow(row) {
  return {
    phone: row.phone,
    contactName: row.contact_name || '',
    segmentLabels: row.segment_labels || '',
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    interactiveResponseAt: row.interactive_response_at,
    interactiveResponseText: row.interactive_response_text || '',
  };
}

/** Enriquece filas de respuestas únicas con el primer clic interactivo (si existe). */
function mergeInteractiveIntoResponders(responders, interactiveResponders) {
  const byPhone = new Map(
    (Array.isArray(interactiveResponders) ? interactiveResponders : []).map((row) => [row.phone, row])
  );
  return (Array.isArray(responders) ? responders : []).map((row) => {
    const interactive = byPhone.get(row.phone);
    return {
      ...row,
      interactiveResponseText: interactive?.interactiveResponseText || '',
      interactiveResponseAt: interactive?.interactiveResponseAt || null,
    };
  });
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
       ${sqlContactSegmentLabels('COALESCE(latest_logs.contact_id, conv.contact_id)', '$2')} AS segment_labels,
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

/**
 * Contactos que pulsaron un botón de respuesta rápida (plantilla interactiva)
 * dentro de la ventana post-envío. Una fila por teléfono (primer clic).
 */
async function fetchCampaignInteractiveResponders(query, campaignId, area) {
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
       ${sqlContactSegmentLabels('COALESCE(latest_logs.contact_id, conv.contact_id)', '$2')} AS segment_labels,
       COALESCE(latest_logs.contact_id, conv.contact_id) AS contact_id,
       conv.id AS conversation_id,
       first_btn.created_at AS interactive_response_at,
       first_btn.response_text AS interactive_response_text
     FROM latest_logs
     INNER JOIN conversations conv ON conv.area = $2 AND conv.phone = latest_logs.phone
     INNER JOIN LATERAL (
       SELECT
         cm.created_at,
         ${SQL_INTERACTIVE_RESPONSE_TEXT} AS response_text
       FROM chat_messages cm
       WHERE cm.conversation_id = conv.id
         AND cm.direction = 'inbound'
         AND cm.created_at > latest_logs.created_at
         AND cm.created_at <= latest_logs.created_at + INTERVAL '${RESPONSE_WINDOW_DAYS} days'
         AND ${SQL_IS_INTERACTIVE_INBOUND}
       ORDER BY cm.created_at ASC
       LIMIT 1
     ) first_btn ON TRUE
     LEFT JOIN contacts ct ON ct.id = COALESCE(latest_logs.contact_id, conv.contact_id)
     WHERE ${sqlCampaignLogIsSalidaOk('latest_logs.status')}
       AND first_btn.response_text IS NOT NULL
     ORDER BY first_btn.created_at DESC`,
    [campaignId, area]
  );
  return r.rows.map(mapInteractiveResponderRow);
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
  fetchCampaignInteractiveResponders,
  fetchCampaignResponderMetrics,
  fetchCampaignSalidaOkCount,
  mergeInteractiveIntoResponders,
};
