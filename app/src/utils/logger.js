const crypto = require('crypto');

const DEFAULT_LOG_TIME_ZONE = 'America/Lima';
const CONSOLE_TS_INSTALLED_FLAG = '__maliConsoleTimestampInstalled';

function getLogTimeZone() {
  const tz = String(process.env.LOG_TIME_ZONE || process.env.LOG_TZ || process.env.TZ || '').trim();
  return tz || DEFAULT_LOG_TIME_ZONE;
}

function buildTimestamp() {
  const now = new Date();
  const timeZone = getLogTimeZone();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const part = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    timestamp: `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}`,
    timeZone,
  };
}

function withTimestamp(meta = {}) {
  const base = buildTimestamp();
  return { ...base, ...meta };
}

function parseJsonObjectMaybe(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') && trimmed.endsWith('}'))) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

function installGlobalConsoleTimestamping() {
  if (global[CONSOLE_TS_INSTALLED_FLAG]) return;
  global[CONSOLE_TS_INSTALLED_FLAG] = true;

  const originals = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  function decorate(methodName) {
    return (...args) => {
      const original = originals[methodName];
      if (args.length === 1) {
        const parsed = parseJsonObjectMaybe(args[0]);
        if (parsed) {
          const enriched = parsed.timestamp ? parsed : withTimestamp(parsed);
          original(JSON.stringify(enriched));
          return;
        }
      }
      const { timestamp, timeZone } = buildTimestamp();
      original(`[${timestamp} ${timeZone}]`, ...args);
    };
  }

  console.log = decorate('log');
  console.info = decorate('info');
  console.warn = decorate('warn');
  console.error = decorate('error');
}

function getRequestId(req) {
  return req.get('x-request-id') || crypto.randomUUID();
}

function logInfo(req, message, meta = {}) {
  console.log(
    JSON.stringify({
      ...buildTimestamp(),
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
      ...buildTimestamp(),
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

function logWarn(req, message, meta = {}) {
  console.warn(
    JSON.stringify({
      ...buildTimestamp(),
      level: 'warn',
      message,
      requestId: getRequestId(req),
      path: req.path,
      method: req.method,
      ...meta,
    })
  );
}

module.exports = {
  getRequestId,
  logInfo,
  logError,
  logWarn,
  buildTimestamp,
  withTimestamp,
  installGlobalConsoleTimestamping,
};
