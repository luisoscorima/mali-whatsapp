const DISPLAY_TIMEZONE = 'America/Lima'

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  return new Date(value).toLocaleString('es-PE')
}

/** Lista de chats: hora si es hoy, fecha corta si no. */
export function formatChatListTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const now = new Date()
  const tz = DISPLAY_TIMEZONE
  const dayKey = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: tz })
  if (dayKey(date) === dayKey(now)) {
    return date.toLocaleTimeString('es-PE', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: tz,
    })
  }
  const y1 = date.toLocaleDateString('en-CA', { timeZone: tz, year: 'numeric' })
  const y2 = now.toLocaleDateString('en-CA', { timeZone: tz, year: 'numeric' })
  if (y1 === y2) {
    return date.toLocaleDateString('es-PE', {
      day: '2-digit',
      month: 'short',
      timeZone: tz,
    })
  }
  return date.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    timeZone: tz,
  })
}
