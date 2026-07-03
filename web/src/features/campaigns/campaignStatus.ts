export function campaignStatusClass(status: string): string {
  const s = status.toLowerCase()
  if (s === 'completed') return 'bg-accent-soft text-accent'
  if (s === 'processing' || s === 'queued' || s === 'scheduled') {
    return 'bg-line text-muted'
  }
  if (s === 'failed') return 'bg-bad/15 text-bad'
  return 'bg-line text-muted'
}
