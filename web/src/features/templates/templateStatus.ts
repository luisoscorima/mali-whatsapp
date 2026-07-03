export function templateStatusClass(status: string): string {
  const s = status.toUpperCase()
  if (s === 'APPROVED') return 'bg-accent-soft text-accent'
  if (s === 'PENDING') return 'bg-line text-muted'
  if (s === 'REJECTED' || s === 'DISABLED') return 'bg-bad/15 text-bad'
  return 'bg-line text-muted'
}
