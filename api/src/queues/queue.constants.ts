export const CAMPAIGNS_QUEUE = 'campaigns';
export const MAINTENANCE_QUEUE = 'maintenance';

export const CampaignJobName = {
  SEND: 'send',
  RETRY: 'retry',
} as const;

export const MaintenanceJobName = {
  PROMOTE_SCHEDULED: 'promote-scheduled',
  PROMOTE_AUTO_RETRIES: 'promote-auto-retries',
  PROMOTE_FLOW_TIMEOUTS: 'promote-flow-timeouts',
  AUDIT_PURGE: 'audit-purge',
  STARTUP_CAMPAIGNS: 'startup-campaigns',
  EXPIRE_EDUCATION_LEADS: 'expire-education-leads',
} as const;

export const AUDIT_PURGE_MS = 24 * 60 * 60 * 1000;
export const EDUCATION_LEAD_EXPIRE_MS = 60 * 60 * 1000;
