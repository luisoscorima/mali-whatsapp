import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppUser } from '@/app/appOutletContext'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { MetricsGrid } from '../campaigns/MetricsGrid'
import type { MetricCard } from '../campaigns/campaignMetricActions'

type TemplateSummary = {
  kpis: MetricCard[]
}

const KPI_FILTER_MAP: Record<string, { status?: string; visibility?: string }> = {
  Aprobadas: { status: 'APPROVED' },
  Pendientes: { status: 'PENDING' },
  Rechazadas: { status: 'REJECTED' },
}

export function TemplatesSummaryPane() {
  const user = useAppUser()
  const area = user?.area
  const [, setSearchParams] = useSearchParams()
  const [summary, setSummary] = useState<TemplateSummary | null>(null)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!area) return
    setSummary(null)
    setError('')
    let cancelled = false
    void apiClient.get<TemplateSummary>('/api/templates/summary').then((res) => {
      if (cancelled) return
      if (!res.ok) {
        notify.error(res.error)
        setError(res.error)
      } else {
        setSummary(res.data)
        setError('')
      }
    })
    return () => {
      cancelled = true
    }
  }, [area, reloadToken])

  const metrics = useMemo(
    () =>
      (summary?.kpis ?? []).map((metric) => ({
        ...metric,
        interactive: Boolean(KPI_FILTER_MAP[metric.label]),
      })),
    [summary],
  )

  function applyKpiFilter(metric: MetricCard) {
    const mapping = KPI_FILTER_MAP[metric.label]
    if (!mapping) return
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      if (mapping.status) next.set('status', mapping.status)
      else next.delete('status')
      if (mapping.visibility) next.set('visibility', mapping.visibility)
      return next
    })
  }

  if (error) {
    return (
      <WaEmptyPane>
        <div className="inbox-empty-hint space-y-3">
          <h2 className="inbox-empty-heading">No se pudo cargar</h2>
          <button
            type="button"
            className="small-btn"
            onClick={() => setReloadToken((n) => n + 1)}
          >
            Reintentar
          </button>
        </div>
      </WaEmptyPane>
    )
  }

  if (!user || !summary) {
    return <WaEmptyPane heading="Cargando resumen…" />
  }

  return (
    <WaEmptyPane variant="history">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Plantillas</h2>
          <p className="text-sm text-muted">
            Selecciona una plantilla de la lista o usa un KPI para filtrar.
          </p>
        </div>
        <MetricsGrid title="Inventario" metrics={metrics} onMetricClick={applyKpiFilter} />
        <p className="text-sm text-muted">
          Selecciona una plantilla de la lista o sincroniza desde Meta.
        </p>
      </div>
    </WaEmptyPane>
  )
}
