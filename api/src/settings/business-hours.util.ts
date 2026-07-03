export const DEFAULT_TIMEZONE = 'America/Lima';
export const MAX_SESSION_TEXT_LEN = 4096;

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAY_TO_NUM: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export type BusinessHoursConfig = {
  enabled: boolean;
  timezone: string;
  days: number[];
  from: string;
  to: string;
  outside_hours_message: string;
  fromMinutes?: number | null;
  toMinutes?: number | null;
};

function parseTimeToMinutes(value: unknown): number | null {
  const m = String(value || '')
    .trim()
    .match(HHMM_RE);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

export function parseBusinessHoursConfig(raw: unknown): BusinessHoursConfig | null {
  if (raw == null || String(raw).trim() === '') return null;
  try {
    const o = JSON.parse(String(raw)) as Record<string, unknown>;
    const days = Array.isArray(o.days)
      ? o.days
          .map((d) => Number(d))
          .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
      : [];
    const from = String(o.from || '').trim();
    const to = String(o.to || '').trim();
    const fromMinutes = parseTimeToMinutes(from);
    const toMinutes = parseTimeToMinutes(to);
    return {
      enabled: Boolean(o.enabled),
      timezone: String(o.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE,
      days: [...new Set(days)].sort((a, b) => a - b),
      from,
      to,
      outside_hours_message: String(o.outside_hours_message ?? '').trim(),
      fromMinutes,
      toMinutes,
    };
  } catch {
    return null;
  }
}

export function defaultBusinessHoursSeed(): Omit<
  BusinessHoursConfig,
  'fromMinutes' | 'toMinutes'
> {
  return {
    enabled: false,
    timezone: DEFAULT_TIMEZONE,
    days: [1, 2, 3, 4, 5],
    from: '09:00',
    to: '18:00',
    outside_hours_message: '',
  };
}

export function validateBusinessHoursInput(
  body: unknown,
  maxMessageLen = MAX_SESSION_TEXT_LEN,
): { config: Omit<BusinessHoursConfig, 'fromMinutes' | 'toMinutes'> } | { error: string } {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'JSON invalido' };
  }
  const src = body as Record<string, unknown>;
  const enabled = Boolean(src.enabled);
  const timezone =
    String(src.timezone || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
  const days = Array.isArray(src.days)
    ? [
        ...new Set(
          src.days
            .map((d) => Number(d))
            .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
        ),
      ].sort((a, b) => a - b)
    : [];
  const from = String(src.from || '').trim();
  const to = String(src.to || '').trim();
  const message = String(src.outside_hours_message ?? '')
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

export { WEEKDAY_TO_NUM };

function getZonedDayAndMinutes(
  date: Date,
  timezone: string,
): { day: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  const day = WEEKDAY_TO_NUM[map.weekday ?? 'Sun'] ?? 0;
  const hour = parseInt(map.hour ?? '0', 10);
  const minute = parseInt(map.minute ?? '0', 10);
  return { day, minutes: hour * 60 + minute };
}

export function isBusinessHoursConfigOperational(
  config: BusinessHoursConfig | null,
): boolean {
  if (!config || !config.enabled) return false;
  if (!config.outside_hours_message) return false;
  if (!config.days.length) return false;
  if (config.fromMinutes == null || config.toMinutes == null) return false;
  return true;
}

export function isWithinBusinessHours(
  config: BusinessHoursConfig | null,
  now = new Date(),
): boolean {
  if (!config || config.fromMinutes == null || config.toMinutes == null) {
    return false;
  }
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
