export type MetricAction =
  | { type: 'logs'; filter: string; title: string; note?: string }
  | { type: 'incidents'; filter: string; title: string; note?: string }
  | { type: 'responders'; title: string }
  | { type: 'concepts' }

export type MetricCard = {
  label: string
  display: string
  displayLines?: string[] | null
  tone?: string
  tooltip?: string
  action?: MetricAction | null
}

const ACTION_BY_LABEL: Record<string, MetricAction> = {
  'Total destinatarios': {
    type: 'logs',
    filter: 'all_current',
    title: 'Registro actual · Total destinatarios',
  },
  Enviados: {
    type: 'logs',
    filter: 'sent_all',
    title: 'Registro actual · Enviados',
  },
  'Problemas de entrega': {
    type: 'incidents',
    filter: 'all',
    title: 'Incidencias activas · Problemas de entrega',
  },
  Entregados: {
    type: 'logs',
    filter: 'delivered_all',
    title: 'Registro actual · Entregados',
  },
  Leídos: {
    type: 'logs',
    filter: 'read_only',
    title: 'Registro actual · Leídos',
  },
  'Respuestas únicas': {
    type: 'responders',
    title: 'Respuestas únicas',
  },
  'Pendientes de entrega': {
    type: 'logs',
    filter: 'sent_only',
    title: 'Registro actual · Pendientes de entrega',
  },
  'Entregados no leídos': {
    type: 'logs',
    filter: 'delivered_only',
    title: 'Registro actual · Entregados no leídos',
  },
  'Mensajes no entregables': {
    type: 'incidents',
    filter: 'undeliverable',
    title: 'Incidencias · Mensajes no entregables',
  },
  'Limitaciones Meta': {
    type: 'incidents',
    filter: 'meta_limit',
    title: 'Incidencias · Limitaciones Meta',
  },
  Experimentos: {
    type: 'incidents',
    filter: 'experiment',
    title: 'Incidencias · Experimentos',
  },
}

export function attachMetricActions(metrics: MetricCard[]): MetricCard[] {
  return metrics.map((metric) => ({
    ...metric,
    action: metric.action ?? ACTION_BY_LABEL[metric.label] ?? null,
  }))
}
