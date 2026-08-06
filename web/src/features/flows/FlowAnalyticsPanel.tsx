import type { FlowAnalytics } from './flowEditorUtils'
import type { FlowDrilldownQuery } from './FlowDrilldownDialog'

function MetricButton({
  label,
  value,
  onClick,
}: {
  label: string
  value: number
  onClick?: () => void
}) {
  const clickable = Boolean(onClick) && value >= 0
  return (
    <button
      type="button"
      disabled={!clickable || !onClick}
      onClick={onClick}
      className={`rounded-xl border border-line bg-surface-strong p-3 text-left transition ${
        onClick
          ? 'cursor-pointer hover:border-accent hover:shadow-sm'
          : 'cursor-default'
      }`}
    >
      <p className="text-lg font-semibold">{value}</p>
      <p className="mt-0.5 text-xs text-muted">{label}</p>
    </button>
  )
}

export function FlowAnalyticsPanel({
  analytics,
  onOpenDrilldown,
}: {
  analytics: FlowAnalytics
  onOpenDrilldown: (query: FlowDrilldownQuery) => void
}) {
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <MetricButton
          label="Iniciadas"
          value={analytics.started}
          onClick={() =>
            onOpenDrilldown({ title: 'Sesiones iniciadas', event_type: 'started' })
          }
        />
        <MetricButton
          label="Activas"
          value={analytics.active}
          onClick={() =>
            onOpenDrilldown({ title: 'Sesiones activas', event_type: 'active' })
          }
        />
        <MetricButton
          label="Completadas"
          value={analytics.completed}
          onClick={() =>
            onOpenDrilldown({
              title: 'Sesiones completadas',
              event_type: 'completed',
            })
          }
        />
        <MetricButton
          label="Derivadas"
          value={analytics.handed_off}
          onClick={() =>
            onOpenDrilldown({
              title: 'Sesiones derivadas',
              event_type: 'handed_off',
            })
          }
        />
        <MetricButton
          label="Cierre por silencio"
          value={analytics.timeout_closed}
          onClick={() =>
            onOpenDrilldown({
              title: 'Cierre por silencio',
              event_type: 'timeout_closed',
            })
          }
        />
      </div>

      {analytics.nodes.length > 0 ? (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[480px] text-left text-sm">
            <thead className="border-b border-line bg-surface-strong text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Paso</th>
                <th className="px-3 py-2 font-medium">Llegaron</th>
                <th className="px-3 py-2 font-medium">Respondieron</th>
                <th className="px-3 py-2 font-medium">Esperando</th>
              </tr>
            </thead>
            <tbody>
              {analytics.nodes.map((n) => (
                <tr key={n.client_key} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <span className="line-clamp-2">
                      {n.deleted ? `Eliminado: ${n.label}` : n.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() =>
                        onOpenDrilldown({
                          title: `Llegaron — ${n.label}`,
                          event_type: 'entered',
                          client_key: n.client_key,
                        })
                      }
                    >
                      {n.entered}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() =>
                        onOpenDrilldown({
                          title: `Respondieron — ${n.label}`,
                          event_type: 'replied',
                          client_key: n.client_key,
                        })
                      }
                    >
                      {n.replied}
                    </button>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      className="text-accent hover:underline"
                      onClick={() =>
                        onOpenDrilldown({
                          title: `Esperando — ${n.label}`,
                          event_type: 'active',
                          client_key: n.client_key,
                        })
                      }
                    >
                      {n.waiting}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted text-sm">Aún no hay historial de pasos en este flujo.</p>
      )}
    </div>
  )
}
