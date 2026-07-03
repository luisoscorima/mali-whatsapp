export const LOG_EXPORT_FILTERS = [
  { value: 'all_current', label: 'Último estado por teléfono' },
  { value: 'sent_all', label: 'Enviados (sent, delivered, read)' },
  { value: 'delivered_all', label: 'Entregados (delivered, read)' },
  { value: 'read_only', label: 'Solo leídos' },
  { value: 'sent_only', label: 'Solo sent (pendientes)' },
  { value: 'delivered_only', label: 'Entregados no leídos' },
] as const

export const INCIDENT_EXPORT_FILTERS = [
  { value: 'all', label: 'Todas las incidencias' },
  { value: 'undeliverable', label: 'Mensajes no entregables' },
  { value: 'meta_limit', label: 'Limitaciones Meta' },
  { value: 'experiment', label: 'Experimentos' },
] as const

type LogRow = { phone?: string; id?: number; status?: string }

function normalizeStatus(status: unknown): string {
  return String(status || '')
    .trim()
    .toLowerCase()
}

function latestLogsByPhone<T extends LogRow>(logs: T[]): T[] {
  const out: T[] = []
  const seen = new Set<string>()
  for (const log of logs) {
    const phone = String(log.phone || '').trim()
    const key = phone || `log:${String(log.id || '')}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(log)
  }
  return out
}

export function filterCampaignLogs<T extends LogRow>(
  logs: T[],
  filter: string,
): T[] {
  const latest = latestLogsByPhone(logs)
  const key = String(filter || 'all_current')
    .trim()
    .toLowerCase()
  if (!key || key === 'all_current') return latest
  return latest.filter((log) => {
    const status = normalizeStatus(log.status)
    if (key === 'sent_all') {
      return status === 'sent' || status === 'delivered' || status === 'read'
    }
    if (key === 'delivered_all') {
      return status === 'delivered' || status === 'read'
    }
    if (key === 'read_only') return status === 'read'
    if (key === 'sent_only') return status === 'sent'
    if (key === 'delivered_only') return status === 'delivered'
    return true
  })
}

export function filterIncidentLogs<
  T extends { incident_type?: string },
>(logs: T[], filter: string): T[] {
  const key = String(filter || 'all')
    .trim()
    .toLowerCase()
  if (!key || key === 'all') return logs
  return logs.filter(
    (log) =>
      String(log.incident_type || '')
        .trim()
        .toLowerCase() === key,
  )
}
