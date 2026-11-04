/** Config editable de SLA primera respuesta (Educación). Defaults = RQ0020/RQ0021. */

export const EDUCATION_SLA_SETTINGS_AREA = 'educacion';
export const EDUCATION_SLA_SETTINGS_KEY = 'education_sla';
export const DEFAULT_SLA_TIMEZONE = 'America/Lima';
export const DEFAULT_SLA_TARGET_MINUTES = 10;
export const MIN_SLA_TARGET_MINUTES = 5;
export const MAX_SLA_TARGET_MINUTES = 60;

const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Weekday 0=Sun … 6=Sat → [fromMinute, toMinute) in local minutes. */
export type SlaDayWindow = { from: number; to: number };
export type SlaSchedule = Partial<Record<number, SlaDayWindow>>;

export type EducationSlaConfig = {
  target_minutes: number;
  timezone: string;
  schedule: SlaSchedule;
};

export type EducationSlaDayInput = {
  day: number;
  from: string;
  to: string;
};

export type EducationSlaConfigView = {
  target_minutes: number;
  timezone: string;
  days: EducationSlaDayInput[];
};

/** Default RQ schedule (Lima). */
export function defaultSlaSchedule(): SlaSchedule {
  return {
    0: { from: 9 * 60, to: 18 * 60 },
    1: { from: 8 * 60 + 30, to: 20 * 60 },
    2: { from: 8 * 60 + 30, to: 20 * 60 },
    3: { from: 8 * 60 + 30, to: 20 * 60 },
    4: { from: 8 * 60 + 30, to: 20 * 60 },
    5: { from: 8 * 60 + 30, to: 20 * 60 },
    6: { from: 8 * 60 + 30, to: 18 * 60 },
  };
}

export function defaultEducationSlaConfig(): EducationSlaConfig {
  return {
    target_minutes: DEFAULT_SLA_TARGET_MINUTES,
    timezone: DEFAULT_SLA_TIMEZONE,
    schedule: defaultSlaSchedule(),
  };
}

function parseTimeToMinutes(value: unknown): number | null {
  const m = String(value || '')
    .trim()
    .match(HHMM_RE);
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function minutesToHhmm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function scheduleToDays(schedule: SlaSchedule): EducationSlaDayInput[] {
  const days: EducationSlaDayInput[] = [];
  for (let day = 0; day <= 6; day += 1) {
    const win = schedule[day];
    if (!win) continue;
    days.push({
      day,
      from: minutesToHhmm(win.from),
      to: minutesToHhmm(win.to),
    });
  }
  return days;
}

export function educationSlaConfigToView(
  config: EducationSlaConfig,
): EducationSlaConfigView {
  return {
    target_minutes: config.target_minutes,
    timezone: config.timezone,
    days: scheduleToDays(config.schedule),
  };
}

export function parseEducationSlaConfig(raw: unknown): EducationSlaConfig | null {
  if (raw == null || String(raw).trim() === '') return null;
  try {
    const o =
      typeof raw === 'string'
        ? (JSON.parse(raw) as Record<string, unknown>)
        : (raw as Record<string, unknown>);
    const target = Number(o.target_minutes);
    if (
      !Number.isInteger(target) ||
      target < MIN_SLA_TARGET_MINUTES ||
      target > MAX_SLA_TARGET_MINUTES
    ) {
      return null;
    }
    const schedule: SlaSchedule = {};
    const days = Array.isArray(o.days) ? o.days : [];
    for (const item of days) {
      if (item == null || typeof item !== 'object') continue;
      const row = item as Record<string, unknown>;
      const day = Number(row.day);
      if (!Number.isInteger(day) || day < 0 || day > 6) continue;
      const from = parseTimeToMinutes(row.from);
      const to = parseTimeToMinutes(row.to);
      if (from == null || to == null || to <= from) continue;
      schedule[day] = { from, to };
    }
    if (Object.keys(schedule).length === 0) return null;
    return {
      target_minutes: target,
      timezone: DEFAULT_SLA_TIMEZONE,
      schedule,
    };
  } catch {
    return null;
  }
}

export function validateEducationSlaInput(
  body: unknown,
): { config: EducationSlaConfig } | { error: string } {
  if (body == null || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'JSON inválido' };
  }
  const src = body as Record<string, unknown>;
  const target = Number(src.target_minutes);
  if (
    !Number.isInteger(target) ||
    target < MIN_SLA_TARGET_MINUTES ||
    target > MAX_SLA_TARGET_MINUTES
  ) {
    return {
      error: `La meta debe ser un entero entre ${MIN_SLA_TARGET_MINUTES} y ${MAX_SLA_TARGET_MINUTES} minutos`,
    };
  }
  const schedule: SlaSchedule = {};
  const days = Array.isArray(src.days) ? src.days : [];
  if (!days.length) {
    return { error: 'Selecciona al menos un día con horario' };
  }
  for (const item of days) {
    if (item == null || typeof item !== 'object') {
      return { error: 'Día de horario inválido' };
    }
    const row = item as Record<string, unknown>;
    const day = Number(row.day);
    if (!Number.isInteger(day) || day < 0 || day > 6) {
      return { error: 'Día inválido (0–6)' };
    }
    const from = parseTimeToMinutes(row.from);
    const to = parseTimeToMinutes(row.to);
    if (from == null || to == null) {
      return { error: 'Horario inválido (usa HH:MM)' };
    }
    if (to <= from) {
      return { error: 'La hora de fin debe ser posterior al inicio' };
    }
    schedule[day] = { from, to };
  }
  return {
    config: {
      target_minutes: target,
      timezone: DEFAULT_SLA_TIMEZONE,
      schedule,
    },
  };
}

export function serializeEducationSlaConfig(config: EducationSlaConfig): string {
  return JSON.stringify({
    target_minutes: config.target_minutes,
    timezone: config.timezone,
    days: scheduleToDays(config.schedule),
  });
}
