const crypto = require('crypto');

function getRequestId(req) {
  return req.get('x-request-id') || crypto.randomUUID();
}

function logInfo(req, message, meta = {}) {
  console.log(
    JSON.stringify({
      level: 'info',
      message,
      requestId: getRequestId(req),
      path: req.path,
      method: req.method,
      ...meta,
    })
  );
}

function logError(req, message, error, meta = {}) {
  console.error(
    JSON.stringify({
      level: 'error',
      message,
      requestId: getRequestId(req),
      path: req.path,
      method: req.method,
      error: error?.message || String(error),
      status: error?.response?.status,
      metaResponse: error?.response?.data || null,
      ...meta,
    })
  );
}

module.exports = { getRequestId, logInfo, logError };
