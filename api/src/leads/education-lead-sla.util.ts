/** Primera respuesta humana: minutos hábiles (RQ0020 / RQ0021). Lima, sin DST. */

import {
  DEFAULT_SLA_TARGET_MINUTES,
  DEFAULT_SLA_TIMEZONE,
  defaultEducationSlaConfig,
  type EducationSlaConfig,
  type SlaSchedule,
} from './education-sla-config.util';

export const SLA_TIMEZONE = DEFAULT_SLA_TIMEZONE;
/** Default meta; prefer config.target_minutes en runtime. */
export const SLA_FIRST_REPLY_MINUTES = DEFAULT_SLA_TARGET_MINUTES;
export const SLA_ALERT_EVENT_TYPE = 'sla_first_reply';
export const NEW_LEAD_ALERT_EVENT_TYPE = 'new_lead';

export type { EducationSlaConfig };

/** Peru is UTC−5 year-round; wall time via fixed offset. */
const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;

type LimaParts = {
  y: number;
  m: number;
  day: number;
  dow: number;
  minutes: number;
};

function limaParts(date: Date): LimaParts {
  const shifted = new Date(date.getTime() + LIMA_OFFSET_MS);
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    dow: shifted.getUTCDay(),
    minutes: shifted.getUTCHours() * 60 + shifted.getUTCMinutes(),
  };
}

/** Instant for a Lima wall clock (minutes may be 0–1439). Day overflow OK via Date.UTC. */
function fromLima(
  y: number,
  m: number,
  day: number,
  minutes: number,
): Date {
  const h = Math.floor(minutes / 60);
  const min = minutes % 60;
  return new Date(Date.UTC(y, m, day, h, min, 0, 0) - LIMA_OFFSET_MS);
}

function resolveConfig(config?: EducationSlaConfig | null): EducationSlaConfig {
  return config ?? defaultEducationSlaConfig();
}

/** Minutes inside SLA schedule between `from` and `to` (exclusive end). */
export function businessMinutesBetween(
  from: Date,
  to: Date,
  schedule?: SlaSchedule | null,
): number {
  if (!(from instanceof Date) || !(to instanceof Date)) return 0;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  if (to.getTime() <= from.getTime()) return 0;

  const schedMap = schedule ?? defaultEducationSlaConfig().schedule;
  let totalMs = 0;
  let cursor = from;
  for (let i = 0; i < 400 && cursor.getTime() < to.getTime(); i += 1) {
    const p = limaParts(cursor);
    const sched = schedMap[p.dow];
    if (sched) {
      const dayStart = fromLima(p.y, p.m, p.day, sched.from);
      const dayEnd = fromLima(p.y, p.m, p.day, sched.to);
      const a = Math.max(cursor.getTime(), dayStart.getTime());
      const b = Math.min(to.getTime(), dayEnd.getTime());
      if (b > a) totalMs += b - a;
    }
    const nextMidnight = fromLima(p.y, p.m, p.day + 1, 0);
    cursor =
      nextMidnight.getTime() > cursor.getTime()
        ? nextMidnight
        : new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return totalMs / 60_000;
}

export function firstResponseBusinessMinutes(
  startedAt: Date,
  repliedAt: Date,
  config?: EducationSlaConfig | null,
): number {
  return businessMinutesBetween(
    startedAt,
    repliedAt,
    resolveConfig(config).schedule,
  );
}

export function isSlaMet(
  startedAt: Date,
  repliedAt: Date,
  config?: EducationSlaConfig | null,
): boolean {
  const cfg = resolveConfig(config);
  return (
    firstResponseBusinessMinutes(startedAt, repliedAt, cfg) <=
    cfg.target_minutes
  );
}

/**
 * Open cycle without human reply and past the SLA target.
 * Strict `>` so a reply at exactly T+target still counts as met (`isSlaMet` uses `<=`).
 */
export function isSlaBreached(
  startedAt: Date,
  now: Date = new Date(),
  config?: EducationSlaConfig | null,
): boolean {
  const cfg = resolveConfig(config);
  return (
    businessMinutesBetween(startedAt, now, cfg.schedule) > cfg.target_minutes
  );
}

/**
 * Latest `started_at` that already exceeds the SLA by `now`.
 * Use as query upper bound so overnight waiters (not yet breached) do not fill the scan batch.
 */
export function latestStartTimeForBreach(
  now: Date = new Date(),
  config?: EducationSlaConfig | null,
): Date {
  const cfg = resolveConfig(config);
  let remainingMs = cfg.target_minutes * 60_000;
  let cursor = now;
  for (let i = 0; i < 400 && remainingMs > 0; i += 1) {
    const p = limaParts(cursor);
    const sched = cfg.schedule[p.dow];
    if (sched) {
      const dayStart = fromLima(p.y, p.m, p.day, sched.from);
      const dayEnd = fromLima(p.y, p.m, p.day, sched.to);
      const b = Math.min(cursor.getTime(), dayEnd.getTime());
      const a = dayStart.getTime();
      if (b > a) {
        const available = b - a;
        if (available > remainingMs) {
          return new Date(b - remainingMs - 1);
        }
        remainingMs -= available;
        if (remainingMs === 0) {
          return new Date(a - 1);
        }
      }
    }
    cursor = new Date(fromLima(p.y, p.m, p.day, 0).getTime() - 1);
  }
  return cursor;
}

export function roundMinutes(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
