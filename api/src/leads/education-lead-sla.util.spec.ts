import {
  SLA_FIRST_REPLY_MINUTES,
  businessMinutesBetween,
  isSlaBreached,
  isSlaMet,
  latestStartTimeForBreach,
} from './education-lead-sla.util';

/** Lima wall → UTC Date (Peru UTC−5). */
function lima(y: number, m: number, d: number, hh: number, mm: number): Date {
  return new Date(Date.UTC(y, m - 1, d, hh + 5, mm, 0, 0));
}

describe('education-lead-sla.util', () => {
  it('counts only business minutes on a weekday', () => {
    const start = lima(2026, 11, 4, 9, 0); // Wed
    const end = lima(2026, 11, 4, 9, 10);
    expect(businessMinutesBetween(start, end)).toBe(10);
    expect(isSlaMet(start, end)).toBe(true);
    expect(isSlaMet(start, lima(2026, 11, 4, 9, 11))).toBe(false);
  });

  it('does not count minutes outside hours', () => {
    const start = lima(2026, 11, 4, 20, 0); // Wed 20:00 close
    const end = lima(2026, 11, 4, 21, 0);
    expect(businessMinutesBetween(start, end)).toBe(0);
    expect(isSlaBreached(start, end)).toBe(false);
  });

  it('pauses overnight and resumes next open', () => {
    // Wed 19:55 → Thu 08:40 = 5 min Wed + 10 min Thu = 15
    const start = lima(2026, 11, 4, 19, 55);
    const end = lima(2026, 11, 5, 8, 40);
    expect(businessMinutesBetween(start, end)).toBe(15);
  });

  it('counts Saturday and Sunday windows (RQ schedule)', () => {
    // Fri 19:55 → Mon 08:35 = 5 Fri + 570 Sat + 540 Sun + 5 Mon
    const start = lima(2026, 11, 6, 19, 55);
    const end = lima(2026, 11, 9, 8, 35);
    expect(businessMinutesBetween(start, end)).toBe(5 + 570 + 540 + 5);
  });

  it('breaches only after exceeding 10 business minutes (reply at T+10 still met)', () => {
    const start = lima(2026, 11, 4, 19, 55); // Wed
    expect(isSlaBreached(start, lima(2026, 11, 5, 8, 35))).toBe(false); // 5+5 = 10
    expect(isSlaBreached(start, lima(2026, 11, 5, 8, 36))).toBe(true); // 5+6 = 11
    expect(isSlaMet(start, lima(2026, 11, 5, 8, 35))).toBe(true);
  });

  it('latestStartTimeForBreach excludes overnight waiters still inside SLA', () => {
    // Thu 08:34 → only 4 min open; need >10 → bound lands Wed before close.
    const now = lima(2026, 11, 5, 8, 34);
    const bound = latestStartTimeForBreach(now);
    expect(isSlaBreached(bound, now)).toBe(true);
    expect(isSlaBreached(lima(2026, 11, 4, 19, 55), now)).toBe(false); // 5+4
    expect(bound.getTime()).toBeLessThan(lima(2026, 11, 4, 19, 55).getTime());
  });

  it('uses Sunday 09:00–18:00 window', () => {
    const start = lima(2026, 11, 8, 8, 50); // Sun before open
    const mid = lima(2026, 11, 8, 9, 5);
    expect(businessMinutesBetween(start, mid)).toBe(5);
  });

  it('returns 0 when end is before start', () => {
    const a = lima(2026, 11, 4, 10, 0);
    const b = lima(2026, 11, 4, 9, 0);
    expect(businessMinutesBetween(a, b)).toBe(0);
  });

  it('exposes the 10-minute threshold constant', () => {
    expect(SLA_FIRST_REPLY_MINUTES).toBe(10);
  });
});
