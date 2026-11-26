export function readSessionWindowMs(): number {
  const fromEnv = Number(process.env.SESSION_WINDOW_MS);
  if (Number.isFinite(fromEnv) && fromEnv > 0) return Math.round(fromEnv);
  return 24 * 60 * 60 * 1000;
}

export function userServiceWindowEndsAt(
  lastUserMessageAt: Date | string | null | undefined,
): Date | null {
  if (!lastUserMessageAt) return null;
  const endsAt = new Date(new Date(lastUserMessageAt).getTime() + readSessionWindowMs());
  return Number.isFinite(endsAt.getTime()) ? endsAt : null;
}

export function isWithinUserServiceWindow(
  lastUserMessageAt: Date | string | null | undefined,
): boolean {
  const endsAt = userServiceWindowEndsAt(lastUserMessageAt);
  return endsAt !== null && Date.now() <= endsAt.getTime();
}
