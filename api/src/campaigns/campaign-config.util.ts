export const MAX_BODY_PARAM_LEN = 1024;
export const MAX_IMAGE_URL_LEN = 2048;
export const MAX_BATCH_SIZE = 100;
export const MAX_BATCH_DELAY_MS = 60000;

export function readDefaultBatchSize(): number {
  const n = Number(process.env.DEFAULT_BATCH_SIZE || 40);
  return Number.isInteger(n) && n > 0 ? n : 40;
}

export function readDefaultBatchDelayMs(): number {
  const n = Number(process.env.DEFAULT_BATCH_DELAY_MS || 1500);
  return Number.isInteger(n) && n >= 0 ? n : 1500;
}

export function readCampaignPhoneMinGapMs(): number {
  const n = Number(process.env.CAMPAIGN_PHONE_MIN_GAP_MS || 5000);
  return Number.isFinite(n) && n >= 0 ? n : 5000;
}

export const CAMPAIGN_SCHEDULE_MIN_MARGIN_MS = 60 * 1000;
export const CAMPAIGN_SCHEDULE_MAX_DAYS = 90;
export const CAMPAIGN_SCHEDULE_POLL_MS = 45 * 1000;

export function readCampaignAutoRetryDelayMinutes(): number {
  const n = Number(process.env.CAMPAIGN_AUTO_RETRY_DELAY_MINUTES || 10);
  if (!Number.isFinite(n) || n < 1) return 10;
  return Math.min(1440, Math.floor(n));
}

export function readCampaignMaxRetryAttempts(): number {
  const n = Number(process.env.CAMPAIGN_MAX_RETRY_ATTEMPTS || 2);
  if (!Number.isFinite(n) || n < 1) return 2;
  return Math.min(10, Math.floor(n));
}

export function readCampaignMaxManualRetries(): number {
  const n = Number(process.env.CAMPAIGN_MAX_MANUAL_RETRIES || 3);
  if (!Number.isFinite(n) || n < 0) return 3;
  return Math.min(20, Math.floor(n));
}
