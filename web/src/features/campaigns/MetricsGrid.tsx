type MetricCard = {
  label: string
  display: string
  displayLines?: string[] | null
  tone?: string
  tooltip?: string
}

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
}: {
  title: string
  metrics: MetricCard[]
}) {
  if (!metrics.length) return null
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {metrics.map((metric) => (
          <div
            key={metric.label}
            className="rounded-xl border border-line bg-surface-strong p-4"
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
          </div>
        ))}
      </div>
    </section>
  )
}
