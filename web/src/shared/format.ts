const DISPLAY_TIMEZONE = 'America/Lima'
const dayFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIMEZONE })
const yearFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: DISPLAY_TIMEZONE, year: 'numeric' })
const timeFormatter = new Intl.DateTimeFormat('es-PE', {
  hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DISPLAY_TIMEZONE,
})
const shortDateFormatter = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit', month: 'short', timeZone: DISPLAY_TIMEZONE,
})
const fullDateFormatter = new Intl.DateTimeFormat('es-PE', {
  day: '2-digit', month: 'short', year: '2-digit', timeZone: DISPLAY_TIMEZONE,
})

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
  if (dayFormatter.format(date) === dayFormatter.format(now)) {
    return timeFormatter.format(date)
  }
  const y1 = yearFormatter.format(date)
  const y2 = yearFormatter.format(now)
  if (y1 === y2) {
    return shortDateFormatter.format(date)
  }
  return fullDateFormatter.format(date)
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
 * Null si no hay entrante, o si el cliente tiene la última palabra pero la ventana 24h ya cerró
 * (no hay expectativa de respuesta libre → evita “5d esperando” en chats cerrados).
 */
export function chatListReplyStatus(
  lastInboundAt: string | Date | null | undefined,
  lastOutboundAt: string | Date | null | undefined,
  options?: { windowOpen?: boolean; nowMs?: number },
): { symbol: '⏱' | '⏳'; label: string; title: string } | null {
  if (!lastInboundAt) return null
  const nowMs = options?.nowMs ?? Date.now()
  const windowOpen = options?.windowOpen !== false
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

  // Cliente tiene la última palabra: solo cuenta como “espera” si aún se puede responder.
  if (!windowOpen) return null

  const label = formatChatListDuration(nowMs - inboundMs)
  return {
    symbol: '⏳',
    label,
    title: `Cliente esperando: ${label}`,
  }
}
