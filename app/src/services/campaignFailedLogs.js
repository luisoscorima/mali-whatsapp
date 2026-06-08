const {
  sqlCampaignLogIsError,
  SALIDA_OK_STATUSES,
  campaignLogStatusColumnSql,
  sqlInList,
} = require('../utils/campaignLogStatuses');
const { summarizeCampaignLogResponse } = require('../utils/campaignLogErrorSummary');
const { classifyCampaignDeliveryIncident } = require('../utils/campaignSendErrorClassify');
const {
  sqlCampaignLogContactJoin,
  sqlCampaignLogContactName,
  sqlCampaignLogSegmentLabels,
} = require('../utils/campaignExportContactMeta');

const SALIDA_OK_IN = sqlInList(SALIDA_OK_STATUSES);

/** Excluye teléfonos que ya tienen un envío exitoso en la misma campaña. */
function sqlNoSuccessfulLogForPhone() {
  const okStatus = campaignLogStatusColumnSql('ok.status');
  return `NOT EXISTS (
    SELECT 1 FROM campaign_logs ok
    WHERE ok.campaign_id = campaign_logs.campaign_id
      AND ok.phone = campaign_logs.phone
      AND ok.id <> campaign_logs.id
      AND ${okStatus} IN ${SALIDA_OK_IN}
  )`;
}

function enrichFailedLogRow(row) {
  const incident = classifyCampaignDeliveryIncident(row.response, row.status);
  return {
    ...row,
    error_summary: summarizeCampaignLogResponse(row.response),
    incident_type: incident.incidentType,
    incident_label: incident.incidentLabel,
  };
}

async function fetchCampaignFailedLogs(query, campaignId, area) {
  const r = await query(
    `SELECT latest_logs.id, latest_logs.phone, latest_logs.status, latest_logs.response,
            latest_logs.created_at, latest_logs.attempt, latest_logs.retryable, latest_logs.last_retry_at,
            ${sqlCampaignLogContactName('$2')},
            ${sqlCampaignLogSegmentLabels('$2')}
     FROM (
       SELECT DISTINCT ON (phone)
         id, phone, contact_id, status, response, created_at, attempt, retryable, last_retry_at
       FROM campaign_logs
       WHERE campaign_id = $1
       ORDER BY phone, id DESC
     ) latest_logs
     ${sqlCampaignLogContactJoin('latest_logs', '$2')}
     WHERE ${sqlCampaignLogIsError('latest_logs.status')}
     ORDER BY latest_logs.id DESC`,
    [campaignId, area]
  );
  return r.rows.map(enrichFailedLogRow);
}

module.exports = {
  fetchCampaignFailedLogs,
  enrichFailedLogRow,
  sqlNoSuccessfulLogForPhone,
};
