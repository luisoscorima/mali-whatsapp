export function readSessionWindowMs(): number {
  const fromEnv = Number(process.env.SESSION_WINDOW_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.round(fromEnv);
  return 24 * 60 * 60 * 1000;
}

export function isWithinUserServiceWindow(
  lastUserMessageAt: Date | string | null | undefined,
): boolean {
  if (!lastUserMessageAt) return false;
  const t = new Date(lastUserMessageAt).getTime();
  if (Number.isNaN(t)) return false;
  return Date.now() - t <= readSessionWindowMs();
}
