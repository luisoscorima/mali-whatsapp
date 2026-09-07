/** Default inclusive calendar-day window for reportería / bitácora. */
export const REPORT_DEFAULT_RANGE_DAYS = 15;

export function getReportDisplayTimeZone(): string {
  const tz =
    String(process.env.DISPLAY_TIMEZONE || 'America/Lima').trim() ||
    'America/Lima';
  if (!/^[A-Za-z0-9_/+-]+$/.test(tz)) return 'America/Lima';
  return tz;
}

export function isYmdDate(value: string | undefined | null): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(String(value).trim()));
}

export function todayYmdInDisplayTz(): string {
  return new Date().toLocaleDateString('en-CA', {
    timeZone: getReportDisplayTimeZone(),
  });
}

/** Add calendar days to a YMD string (UTC noon arithmetic). */
export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function defaultReportDateRange(
  days = REPORT_DEFAULT_RANGE_DAYS,
): { from: string; to: string } {
  const to = todayYmdInDisplayTz();
  const from = addDaysYmd(to, -(Math.max(1, days) - 1));
  return { from, to };
}

/**
 * If `from` / `to` are missing or invalid, fill with the default 15-day window.
 * Valid provided values are kept.
 */
export function resolveReportDateRange(
  fromRaw?: string,
  toRaw?: string,
): { from: string; to: string } {
  const defaults = defaultReportDateRange();
  const from = isYmdDate(fromRaw) ? String(fromRaw).trim() : defaults.from;
  const to = isYmdDate(toRaw) ? String(toRaw).trim() : defaults.to;
  return { from, to };
}

export function parseSegmentQueryParam(
  raw: string | string[] | undefined,
): string[] {
  if (raw == null) return [];
  const parts = Array.isArray(raw) ? raw : [raw];
  const out = new Set<string>();
  for (const part of parts) {
    for (const piece of String(part).split(',')) {
      const s = piece.trim();
      if (s) out.add(s);
    }
  }
  return [...out];
}
