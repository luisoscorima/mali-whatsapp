const {
  sqlCampaignLogIsError,
  SALIDA_OK_STATUSES,
  campaignLogStatusColumnSql,
  sqlInList,
} = require('../utils/campaignLogStatuses');
const { summarizeCampaignLogResponse } = require('../utils/campaignLogErrorSummary');

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
  return {
    ...row,
    error_summary: summarizeCampaignLogResponse(row.response),
  };
}

async function fetchCampaignFailedLogs(query, campaignId) {
  const r = await query(
    `SELECT id, phone, status, response, created_at, attempt, retryable, last_retry_at
     FROM campaign_logs
     WHERE campaign_id = $1
       AND ${sqlCampaignLogIsError('status')}
       AND ${sqlNoSuccessfulLogForPhone()}
     ORDER BY id DESC`,
    [campaignId]
  );
  return r.rows.map(enrichFailedLogRow);
}

module.exports = {
  fetchCampaignFailedLogs,
  enrichFailedLogRow,
  sqlNoSuccessfulLogForPhone,
};
