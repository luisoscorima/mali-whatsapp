import type { MetricCard } from './campaignMetricActions'

export type MetricAction = NonNullable<MetricCard['action']>

export function resolveMetricAction(metric: MetricCard): MetricAction | null {
  return metric.action ?? null
}
