/** Primera respuesta humana: 10 min hábiles (RQ0020 / RQ0021). Lima, sin DST. */

export const SLA_TIMEZONE = 'America/Lima';
export const SLA_FIRST_REPLY_MINUTES = 10;
export const SLA_ALERT_EVENT_TYPE = 'sla_first_reply';
export const NEW_LEAD_ALERT_EVENT_TYPE = 'new_lead';

/** Peru is UTC−5 year-round; wall time via fixed offset. */
const LIMA_OFFSET_MS = -5 * 60 * 60 * 1000;

/** Weekday 0=Sun … 6=Sat → [fromMinute, toMinute) in local minutes. */
const SCHEDULE: Record<number, { from: number; to: number }> = {
  0: { from: 9 * 60, to: 18 * 60 },
  1: { from: 8 * 60 + 30, to: 20 * 60 },
  2: { from: 8 * 60 + 30, to: 20 * 60 },
  3: { from: 8 * 60 + 30, to: 20 * 60 },
  4: { from: 8 * 60 + 30, to: 20 * 60 },
  5: { from: 8 * 60 + 30, to: 20 * 60 },
  6: { from: 8 * 60 + 30, to: 18 * 60 },
};

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

/** Minutes inside SLA schedule between `from` and `to` (exclusive end). */
export function businessMinutesBetween(from: Date, to: Date): number {
  if (!(from instanceof Date) || !(to instanceof Date)) return 0;
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  if (to.getTime() <= from.getTime()) return 0;

  let totalMs = 0;
  let cursor = from;
  for (let i = 0; i < 400 && cursor.getTime() < to.getTime(); i += 1) {
    const p = limaParts(cursor);
    const sched = SCHEDULE[p.dow];
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
): number {
  return businessMinutesBetween(startedAt, repliedAt);
}

export function isSlaMet(startedAt: Date, repliedAt: Date): boolean {
  return (
    firstResponseBusinessMinutes(startedAt, repliedAt) <= SLA_FIRST_REPLY_MINUTES
  );
}

/** Open cycle without human reply and ≥10 business minutes elapsed. */
export function isSlaBreached(
  startedAt: Date,
  now: Date = new Date(),
): boolean {
  return businessMinutesBetween(startedAt, now) >= SLA_FIRST_REPLY_MINUTES;
}

export function roundMinutes(value: number, digits = 1): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}
