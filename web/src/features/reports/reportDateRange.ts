/** Inclusive calendar-day window matching API REPORT_DEFAULT_RANGE_DAYS. */
export const REPORT_DEFAULT_RANGE_DAYS = 15

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export function todayYmdLocal(): string {
  return new Date().toLocaleDateString('en-CA')
}

export function defaultReportDateRange(
  days = REPORT_DEFAULT_RANGE_DAYS,
): { from: string; to: string } {
  const to = todayYmdLocal()
  const from = addDaysYmd(to, -(Math.max(1, days) - 1))
  return { from, to }
}
