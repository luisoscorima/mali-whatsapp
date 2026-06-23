const DEFAULT_TIMEZONE = 'America/Lima';
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAY_TO_NUM = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parseTimeToMinutes(value) {
  const m = String(value || '').trim().match(HHMM_RE);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

/**
 * Configuración de horario por área (`app_settings`, key `business_hours`).
 * @param {string|null|undefined} raw
 */
function parseBusinessHoursConfig(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  try {
    const o = JSON.parse(String(raw));
    const days = Array.isArray(o.days)
      ? o.days
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    const fromMinutes = parseTimeToMinutes(o.from);
    const toMinutes = parseTimeToMinutes(o.to);
    return {
      enabled: Boolean(o.enabled),
      timezone: String(o.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE,
      days: [...new Set(days)].sort((a, b) => a - b),
      from: String(o.from || '').trim(),
      to: String(o.to || '').trim(),
      outside_hours_message: String(o.outside_hours_message ?? '').trim(),
      fromMinutes,
      toMinutes,
    };
  } catch {
    return null;
  }
}

/**
 * @param {ReturnType<typeof parseBusinessHoursConfig>} config
 */
function isBusinessHoursConfigOperational(config) {
  if (!config || !config.enabled) return false;
  if (!config.outside_hours_message) return false;
  if (!config.days.length) return false;
  if (config.fromMinutes == null || config.toMinutes == null) return false;
  return true;
}

/**
 * @param {ReturnType<typeof parseBusinessHoursConfig>} config
 * @param {Date} [now]
 */
function isWithinBusinessHours(config, now = new Date()) {
  if (!config || config.fromMinutes == null || config.toMinutes == null) return false;
  if (!config.days.length) return false;

  const { day, minutes } = getZonedDayAndMinutes(now, config.timezone);
  if (!config.days.includes(day)) return false;

  const from = config.fromMinutes;
  const to = config.toMinutes;
  if (from <= to) {
    return minutes >= from && minutes < to;
  }
  return minutes >= from || minutes < to;
}

function getZonedDayAndMinutes(date, timezone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const map = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  const day = WEEKDAY_TO_NUM[map.weekday] ?? 0;
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  return { day, minutes: hour * 60 + minute };
}

/**
 * Valida cuerpo PATCH y devuelve objeto listo para persistir o `{ error }`.
 * @param {object} body
 * @param {number} maxMessageLen
 */
function validateBusinessHoursInput(body, maxMessageLen) {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'JSON invalido' };
  }
  const enabled = Boolean(body.enabled);
  const timezone = String(body.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const days = Array.isArray(body.days)
    ? [...new Set(body.days.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort(
        (a, b) => a - b
      )
    : [];
  const from = String(body.from || '').trim();
  const to = String(body.to || '').trim();
  const message = String(body.outside_hours_message ?? '')
    .trim()
    .slice(0, maxMessageLen);

  if (enabled) {
    if (days.length === 0) {
      return { error: 'Selecciona al menos un dia de atencion' };
    }
    if (parseTimeToMinutes(from) == null) {
      return { error: 'Hora desde invalida (use HH:MM)' };
    }
    if (parseTimeToMinutes(to) == null) {
      return { error: 'Hora hasta invalida (use HH:MM)' };
    }
    if (!message) {
      return { error: 'El mensaje fuera de horario es obligatorio' };
    }
  }

  return {
    config: {
      enabled,
      timezone,
      days,
      from,
      to,
      outside_hours_message: message,
    },
  };
}

function defaultBusinessHoursSeed() {
  return {
    enabled: false,
    timezone: DEFAULT_TIMEZONE,
    days: [1, 2, 3, 4, 5],
    from: '09:00',
    to: '18:00',
    outside_hours_message: '',
  };
}

module.exports = {
  DEFAULT_TIMEZONE,
  parseBusinessHoursConfig,
  isBusinessHoursConfigOperational,
  isWithinBusinessHours,
  validateBusinessHoursInput,
  defaultBusinessHoursSeed,
  parseTimeToMinutes,
  getZonedDayAndMinutes,
};
