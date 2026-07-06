import type { MetricCard } from './campaignMetricActions'
import { resolveMetricAction } from './metricAction'

function toneClass(tone?: string): string {
  if (tone === 'sent' || tone === 'delivered' || tone === 'read') {
    return 'text-accent'
  }
  if (tone === 'problem') return 'text-bad'
  return 'text-ink'
}

export function MetricsGrid({
  title,
  metrics,
  onMetricClick,
}: {
  title: string
  metrics: MetricCard[]
  onMetricClick?: (metric: MetricCard) => void
}) {
  if (!metrics.length) return null
  return (
    <section className="space-y-2">
      {title ? <h2 className="text-sm font-medium text-muted">{title}</h2> : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => {
          const action = resolveMetricAction(metric)
          const clickable = Boolean(action && onMetricClick)
          return (
            <button
              key={metric.label}
              type="button"
              disabled={!clickable}
              onClick={() => {
                if (clickable) onMetricClick?.(metric)
              }}
              className={`metric-card rounded-xl border border-line bg-surface-strong p-4 text-left transition ${
                clickable
                  ? 'metric--action cursor-pointer hover:border-accent hover:shadow-sm'
                  : 'cursor-default'
              }`}
              title={metric.tooltip}
            >
              {metric.displayLines && metric.displayLines.length > 0 ? (
                <div className={`space-y-0.5 text-lg font-semibold ${toneClass(metric.tone)}`}>
                  {metric.displayLines.map((line, idx) => (
                    <p key={idx} className={idx > 0 ? 'text-sm font-normal text-muted' : ''}>
                      {line}
                    </p>
                  ))}
                </div>
              ) : (
                <p className={`text-lg font-semibold ${toneClass(metric.tone)}`}>
                  {metric.display}
                </p>
              )}
              <p className="mt-1 text-xs text-muted">{metric.label}</p>
            </button>
          )
        })}
      </div>
    </section>
  )
}
