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

/** Duración compacta para lista (respuesta / espera). */
export function formatChatListDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

/**
 * ⏱ respuesta (saliente ≥ entrante) o ⏳ espera (cliente pendiente).
 * Null si no hay entrante.
 */
export function chatListReplyStatus(
  lastInboundAt: string | Date | null | undefined,
  lastOutboundAt: string | Date | null | undefined,
  nowMs: number = Date.now(),
): { symbol: '⏱' | '⏳'; label: string; title: string } | null {
  if (!lastInboundAt) return null
  const inboundMs = (lastInboundAt instanceof Date
    ? lastInboundAt
    : new Date(lastInboundAt)
  ).getTime()
  if (Number.isNaN(inboundMs)) return null

  const outboundMs = lastOutboundAt
    ? (lastOutboundAt instanceof Date
        ? lastOutboundAt
        : new Date(lastOutboundAt)
      ).getTime()
    : NaN

  if (lastOutboundAt && !Number.isNaN(outboundMs) && outboundMs >= inboundMs) {
    const label = formatChatListDuration(outboundMs - inboundMs)
    return {
      symbol: '⏱',
      label,
      title: `Tiempo de respuesta: ${label}`,
    }
  }

  const label = formatChatListDuration(nowMs - inboundMs)
  return {
    symbol: '⏳',
    label,
    title: `Cliente esperando: ${label}`,
  }
}
