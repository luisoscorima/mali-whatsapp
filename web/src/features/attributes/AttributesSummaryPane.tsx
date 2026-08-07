import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppUser } from '@/app/appOutletContext'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { MetricsGrid } from '../campaigns/MetricsGrid'
import type { MetricCard } from '../campaigns/campaignMetricActions'

type AttributeSummary = {
  kpis: MetricCard[]
}

const KPI_FILTER_MAP: Record<string, { status?: string }> = {
  Activos: { status: 'active' },
  Obligatorios: { status: 'required' },
}

export function AttributesSummaryPane() {
  const user = useAppUser()
  const area = user?.area
  const [, setSearchParams] = useSearchParams()
  const [summary, setSummary] = useState<AttributeSummary | null>(null)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!area) return
    setSummary(null)
    setError('')
    let cancelled = false
    void apiClient
      .get<AttributeSummary>('/api/attribute-definitions/summary')
      .then((res) => {
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
    if (!mapping?.status) return
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      next.set('status', mapping.status!)
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
          <h2 className="text-lg font-semibold">Atributos de contacto</h2>
          <p className="text-sm text-muted">
            Selecciona un atributo de la lista o usa un KPI para filtrar.
          </p>
        </div>
        <MetricsGrid title="Resumen" metrics={metrics} onMetricClick={applyKpiFilter} />
        <p className="text-sm text-muted">
          Selecciona un atributo de la lista o crea uno nuevo.
        </p>
      </div>
    </WaEmptyPane>
  )
}
