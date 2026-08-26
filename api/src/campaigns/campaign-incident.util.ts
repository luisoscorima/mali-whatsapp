import { summarizeCampaignLogResponse } from './campaign-analytics.util';

const PERMANENT_ERROR_CODES = new Set([131026, 132000, 132001, 131047]);
const TRANSIENT_ERROR_CODES = new Set([130429]);
const META_LIMIT_TEXT_HINTS = [
  'rate limit',
  'too many requests',
  'temporarily unavailable',
  'temporarily blocked',
  'throttl',
  'marketing message',
  'marketing messages',
  'ecosystem',
  'pair rate limit',
];
const EXPERIMENT_TEXT_HINTS = [
  'experiment',
  'experimento',
  'control group',
  'holdout',
];

function parseResponseObject(response: unknown): Record<string, unknown> | null {
  if (response == null || response === '') return null;
  if (typeof response === 'object') return response as Record<string, unknown>;
  if (typeof response === 'string') {
    try {
      return JSON.parse(response) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

function extractErrorCode(response: unknown): number | null {
  const data = parseResponseObject(response);
  if (!data) return null;

  const err = data.error as Record<string, unknown> | undefined;
  if (err?.code != null && err.code !== '') {
    const n = Number(err.code);
    if (Number.isFinite(n)) return n;
  }

  const webhookErrors = Array.isArray(data.errors) ? data.errors : [];
  if (webhookErrors.length > 0) {
    const e0 = webhookErrors[0] as Record<string, unknown>;
    if (e0?.code != null && e0.code !== '') {
      const n = Number(e0.code);
      if (Number.isFinite(n)) return n;
    }
  }

  if (data.httpStatus != null) {
    const n = Number(data.httpStatus);
    if (Number.isFinite(n)) return n;
  }

  return null;
}

function buildSearchableErrorText(response: unknown): string {
  const data = parseResponseObject(response);
  if (!data) return '';

  const parts: string[] = [];
  const push = (value: unknown) => {
    const text = String(value ?? '').trim();
    if (text) parts.push(text.toLowerCase());
  };

  push(data.message);
  push((data.error as Record<string, unknown> | undefined)?.message);
  push((data.error as Record<string, unknown> | undefined)?.error_user_msg);
  push((data.error as Record<string, unknown> | undefined)?.error_user_title);
  push((data.error_data as Record<string, unknown> | undefined)?.details);

  const webhookErrors = Array.isArray(data.errors) ? data.errors : [];
  for (const entry of webhookErrors) {
    if (!entry || typeof entry !== 'object') continue;
    const row = entry as Record<string, unknown>;
    push(row.message);
    push(row.title);
    push((row.error_data as Record<string, unknown> | undefined)?.details);
  }

  return parts.join(' | ');
}

function hasAnyTextHint(text: string, hints: string[]): boolean {
  if (!text) return false;
  return hints.some((hint) => text.includes(hint));
}

export type CampaignIncident = {
  incidentType: 'undeliverable' | 'meta_limit' | 'experiment';
  incidentLabel: string;
};

function messageLooksTransient(response: unknown): boolean {
  const msg = buildSearchableErrorText(response);
  return (
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('etimedout') ||
    msg.includes('econnreset') ||
    msg.includes('network') ||
    msg.includes('temporarily unavailable')
  );
}

export function classifyCampaignSendError(response: unknown): {
  retryable: boolean;
  category: 'transient' | 'permanent' | 'unknown';
} {
  const code = extractErrorCode(response);
  const incident = classifyCampaignDeliveryIncident(response);

  if (code != null) {
    if (PERMANENT_ERROR_CODES.has(code)) {
      return { retryable: false, category: 'permanent', ...incident };
    }
    if (
      TRANSIENT_ERROR_CODES.has(code) ||
      code === 429 ||
      (code >= 500 && code < 600)
    ) {
      return { retryable: true, category: 'transient', ...incident };
    }
  }

  if (messageLooksTransient(response)) {
    return { retryable: true, category: 'transient', ...incident };
  }

  if (code == null) {
    return { retryable: true, category: 'unknown', ...incident };
  }

  return { retryable: true, category: 'unknown', ...incident };
}

export function classifyCampaignDeliveryIncident(
  response: unknown,
  status = '',
): CampaignIncident {
  const code = extractErrorCode(response);
  const text = buildSearchableErrorText(response);
  const normalizedStatus = String(status || '')
    .trim()
    .toLowerCase();

  if (
    response &&
    typeof response === 'object' &&
    (response as Record<string, unknown>).code === 'MISSING_TEMPLATE_PARAMS'
  ) {
    return {
      incidentType: 'undeliverable',
      incidentLabel: 'Mensajes no entregables',
    };
  }

  if (hasAnyTextHint(text, EXPERIMENT_TEXT_HINTS)) {
    return { incidentType: 'experiment', incidentLabel: 'Experimentos' };
  }

  if (
    TRANSIENT_ERROR_CODES.has(code ?? -1) ||
    code === 429 ||
    (code != null && code >= 500 && code < 600) ||
    hasAnyTextHint(text, META_LIMIT_TEXT_HINTS)
  ) {
    return { incidentType: 'meta_limit', incidentLabel: 'Limitaciones Meta' };
  }

  if (
    normalizedStatus === 'failed' ||
    normalizedStatus === 'undelivered' ||
    normalizedStatus === 'error'
  ) {
    return {
      incidentType: 'undeliverable',
      incidentLabel: 'Mensajes no entregables',
    };
  }

  return {
    incidentType: 'undeliverable',
    incidentLabel: 'Mensajes no entregables',
  };
}

export type EnrichedFailedLog = {
  id: number;
  phone: string;
  status: string;
  response: unknown;
  created_at: Date | string;
  contact_name?: string;
  contact_email?: string;
  contact_dni?: string;
  segment_labels?: string;
  error_summary: string;
  incident_type: string;
  incident_label: string;
};

export function enrichFailedLogRow(
  row: {
    id: number;
    phone: string;
    status: string;
    response: unknown;
    created_at: Date | string;
    contact_name?: string;
    contact_email?: string;
    contact_dni?: string;
    segment_labels?: string;
  },
): EnrichedFailedLog {
  const incident = classifyCampaignDeliveryIncident(row.response, row.status);
  return {
    ...row,
    error_summary: summarizeCampaignLogResponse(row.response),
    incident_type: incident.incidentType,
    incident_label: incident.incidentLabel,
  };
}
