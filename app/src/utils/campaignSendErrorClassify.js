const { parseResponseObject } = require('./campaignLogErrorSummary');

/** Códigos Meta / HTTP que no deben reintentarse. */
const PERMANENT_ERROR_CODES = new Set([131026, 132000, 132001, 131047]);

/** Rate limit y errores transitorios conocidos. */
const TRANSIENT_ERROR_CODES = new Set([130429]);

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

function messageLooksTransient(response) {
  const data = parseResponseObject(response);
  if (!data || typeof data !== 'object') return false;
  const msg = String(data.error?.message || data.message || '').toLowerCase();
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
 * @returns {{ retryable: boolean, category: 'transient' | 'permanent' | 'unknown' }}
 */
function classifyCampaignSendError(response) {
  const code = extractErrorCode(response);

  if (code != null) {
    if (PERMANENT_ERROR_CODES.has(code)) {
      return { retryable: false, category: 'permanent' };
    }
    if (TRANSIENT_ERROR_CODES.has(code) || code === 429 || (code >= 500 && code < 600)) {
      return { retryable: true, category: 'transient' };
    }
  }

  if (messageLooksTransient(response)) {
    return { retryable: true, category: 'transient' };
  }

  if (code == null) {
    return { retryable: true, category: 'unknown' };
  }

  return { retryable: true, category: 'unknown' };
}

module.exports = {
  classifyCampaignSendError,
  PERMANENT_ERROR_CODES,
  TRANSIENT_ERROR_CODES,
};
