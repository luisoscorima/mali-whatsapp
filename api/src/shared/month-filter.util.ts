export type MonthRange = { start: Date; end: Date };

/** Parses `YYYY-MM` into UTC month bounds (inclusive start, exclusive end). */
export function parseMonthKey(raw: string | undefined | null): MonthRange | null {
  const value = String(raw ?? '').trim();
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
  return { start, end };
}
