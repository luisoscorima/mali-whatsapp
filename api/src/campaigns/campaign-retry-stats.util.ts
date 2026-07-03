import { Prisma } from '@prisma/client';
import {
  campaignLogStatusColumnSql,
  SALIDA_OK_STATUSES,
  sqlCampaignLogIsError,
  sqlInList,
} from './campaign-log-statuses.util';

const SALIDA_OK_IN = sqlInList(SALIDA_OK_STATUSES);

function sqlNoSuccessfulLogForPhone(): string {
  const okStatus = campaignLogStatusColumnSql('ok.status');
  return `NOT EXISTS (
    SELECT 1 FROM campaign_logs ok
    WHERE ok.campaign_id = campaign_logs.campaign_id
      AND ok.phone = campaign_logs.phone
      AND ok.id <> campaign_logs.id
      AND ${okStatus} IN ${SALIDA_OK_IN}
  )`;
}

function readCampaignConfig() {
  const autoRetryDelayMinutes = (() => {
    const n = Number(process.env.CAMPAIGN_AUTO_RETRY_DELAY_MINUTES || 10);
    return Number.isFinite(n) && n > 0 ? n : 10;
  })();
  const maxManualRetries = (() => {
    const n = Number(process.env.CAMPAIGN_MAX_MANUAL_RETRIES || 3);
    return Number.isFinite(n) && n > 0 ? n : 3;
  })();
  return { autoRetryDelayMinutes, maxManualRetries };
}

export type CampaignRetryStats = {
  recoveredCount: number;
  failedCount: number;
  canManualRetry: boolean;
  manualRetryCount: number;
  maxManualRetries: number;
  autoRetryDelayMinutes: number;
  autoRetryPending: boolean;
  autoRetryDone: boolean;
};

type RetryStatsRow = {
  recovered_count: number;
  failed_count: number;
};

type CampaignRetryRow = {
  status: string;
  auto_retry_at: Date | null;
  auto_retry_done: boolean | null;
  manual_retry_count: number | null;
};

export async function fetchCampaignRetryStats(
  prisma: { $queryRaw: <T>(query: Prisma.Sql) => Promise<T> },
  campaignId: number,
): Promise<CampaignRetryStats> {
  const config = readCampaignConfig();
  const okStatus = campaignLogStatusColumnSql('status');

  const rows = await prisma.$queryRaw<RetryStatsRow[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(CASE WHEN ${Prisma.raw(okStatus)} IN ${Prisma.raw(SALIDA_OK_IN)} AND COALESCE(attempt, 1) > 1 THEN 1 ELSE 0 END), 0)::int AS recovered_count,
      COALESCE(SUM(CASE WHEN ${Prisma.raw(sqlCampaignLogIsError('status'))} AND ${Prisma.raw(sqlNoSuccessfulLogForPhone())} THEN 1 ELSE 0 END), 0)::int AS failed_count
    FROM campaign_logs
    WHERE campaign_id = ${campaignId}
  `);

  const campaignRows = await prisma.$queryRaw<CampaignRetryRow[]>(Prisma.sql`
    SELECT status, auto_retry_at, auto_retry_done, manual_retry_count
    FROM campaigns WHERE id = ${campaignId}
  `);

  const row = rows[0] || { recovered_count: 0, failed_count: 0 };
  const campaign = campaignRows[0] || {
    status: '',
    auto_retry_at: null,
    auto_retry_done: null,
    manual_retry_count: 0,
  };

  const status = String(campaign.status || '');
  const canManualRetry =
    row.failed_count > 0 &&
    status !== 'processing' &&
    status !== 'queued' &&
    Number(campaign.manual_retry_count || 0) < config.maxManualRetries;

  const autoRetryPending =
    status === 'completed' &&
    !campaign.auto_retry_done &&
    campaign.auto_retry_at != null &&
    new Date(campaign.auto_retry_at).getTime() > Date.now();

  return {
    recoveredCount: row.recovered_count,
    failedCount: row.failed_count,
    canManualRetry,
    manualRetryCount: Number(campaign.manual_retry_count || 0),
    maxManualRetries: config.maxManualRetries,
    autoRetryDelayMinutes: config.autoRetryDelayMinutes,
    autoRetryPending,
    autoRetryDone: Boolean(campaign.auto_retry_done),
  };
}
