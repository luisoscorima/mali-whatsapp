const { parseResponseObject } = require('./campaignLogErrorSummary');

/** Códigos Meta / HTTP que no deben reintentarse. */
const PERMANENT_ERROR_CODES = new Set([131026, 132000, 132001, 131047]);

/** Rate limit y errores transitorios conocidos. */
const TRANSIENT_ERROR_CODES = new Set([130429]);

/** Señales best-effort para incidentes de entrega en UI. */
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
const EXPERIMENT_TEXT_HINTS = ['experiment', 'experimento', 'control group', 'holdout'];

function extractErrorCode(response) {
  const data = parseResponseObject(response);
  if (!data || typeof data !== 'object') return null;

  const err = data.error;
  if (err && err.code != null && err.code !== '') {
    const n = Number(err.code);
    if (Number.isFinite(n)) return n;
  }

  const webhookErrors = Array.isArray(data.errors) ? data.errors : [];
  if (webhookErrors.length > 0) {
    const e0 = webhookErrors[0];
    if (e0 && e0.code != null && e0.code !== '') {
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

function buildSearchableErrorText(response) {
  const data = parseResponseObject(response);
  if (!data || typeof data !== 'object') return '';

  const parts = [];
  const push = (value) => {
    const text = String(value || '').trim();
    if (text) parts.push(text.toLowerCase());
  };

  push(data.message);
  push(data.error?.message);
  push(data.error?.error_user_msg);
  push(data.error?.error_user_title);
  push(data.error_data?.details);

  const webhookErrors = Array.isArray(data.errors) ? data.errors : [];
  webhookErrors.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    push(entry.message);
    push(entry.title);
    push(entry.error_data?.details);
  });

  return parts.join(' | ');
}

function hasAnyTextHint(text, hints) {
  if (!text) return false;
  return hints.some((hint) => text.includes(hint));
}

function messageLooksTransient(response) {
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

/**
 * Clasifica un error de envío de campaña para decidir si conviene reintentar.
 * @returns {{ retryable: boolean, category: 'transient' | 'permanent' | 'unknown', incidentType: 'undeliverable' | 'meta_limit' | 'experiment', incidentLabel: string }}
 */
function classifyCampaignSendError(response) {
  const code = extractErrorCode(response);
  const incident = classifyCampaignDeliveryIncident(response);

  if (code != null) {
    if (PERMANENT_ERROR_CODES.has(code)) {
      return { retryable: false, category: 'permanent', ...incident };
    }
    if (TRANSIENT_ERROR_CODES.has(code) || code === 429 || (code >= 500 && code < 600)) {
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

function classifyCampaignDeliveryIncident(response, status = '') {
  const code = extractErrorCode(response);
  const text = buildSearchableErrorText(response);
  const normalizedStatus = String(status || '').trim().toLowerCase();

  if (hasAnyTextHint(text, EXPERIMENT_TEXT_HINTS)) {
    return { incidentType: 'experiment', incidentLabel: 'Experimentos' };
  }

  if (
    TRANSIENT_ERROR_CODES.has(code) ||
    code === 429 ||
    (code != null && code >= 500 && code < 600) ||
    hasAnyTextHint(text, META_LIMIT_TEXT_HINTS)
  ) {
    return { incidentType: 'meta_limit', incidentLabel: 'Limitaciones Meta' };
  }

  if (normalizedStatus === 'failed' || normalizedStatus === 'undelivered' || normalizedStatus === 'error') {
    return { incidentType: 'undeliverable', incidentLabel: 'Mensajes no entregables' };
  }

  return { incidentType: 'undeliverable', incidentLabel: 'Mensajes no entregables' };
}

module.exports = {
  buildSearchableErrorText,
  classifyCampaignDeliveryIncident,
  classifyCampaignSendError,
  extractErrorCode,
  PERMANENT_ERROR_CODES,
  TRANSIENT_ERROR_CODES,
};
