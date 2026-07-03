export function formatContactName(
  name: string | null | undefined,
  lastName: string | null | undefined,
  fallback = '',
): string {
  const full = [String(name ?? '').trim(), String(lastName ?? '').trim()]
    .filter(Boolean)
    .join(' ')
  return full || fallback
}
