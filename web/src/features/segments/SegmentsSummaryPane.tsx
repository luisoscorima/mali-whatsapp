import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAppUser } from '@/app/appOutletContext'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { MetricsGrid } from '../campaigns/MetricsGrid'
import type { MetricCard } from '../campaigns/campaignMetricActions'

type SegmentSummary = {
  days: number
  kpis: MetricCard[]
  top_segments: { slug: string; label: string; total: number }[]
}

const KPI_FILTER_MAP: Record<string, { status?: string }> = {
  Activos: { status: 'active' },
  Asignables: { status: 'assignable' },
}

export function SegmentsSummaryPane() {
  const user = useAppUser()
  const area = user?.area
  const [searchParams, setSearchParams] = useSearchParams()
  const [summary, setSummary] = useState<SegmentSummary | null>(null)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  const days = Number(searchParams.get('kpi_days') ?? 30) || 30

  useEffect(() => {
    if (!area) return
    setSummary(null)
    setError('')
    let cancelled = false
    const qs = new URLSearchParams({ days: String(days) })
    void apiClient.get<SegmentSummary>(`/api/segments/summary?${qs}`).then((res) => {
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
  }, [area, days, reloadToken])

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
      next.delete('month')
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
          <h2 className="text-lg font-semibold">Segmentos</h2>
          <p className="text-sm text-muted">
            Selecciona un segmento de la lista o usa un KPI para filtrar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {[7, 14, 30].map((n) => (
            <button
              key={n}
              type="button"
              className={`inbox-chat-pill contact-filter-pill ${days === n ? 'is-active' : ''}`}
              onClick={() =>
                setSearchParams((sp) => {
                  const next = new URLSearchParams(sp)
                  next.set('kpi_days', String(n))
                  return next
                })
              }
            >
              {n} días
            </button>
          ))}
        </div>

        <MetricsGrid title="Resumen" metrics={metrics} onMetricClick={applyKpiFilter} />

        {summary.top_segments.length > 0 ? (
          <p className="text-sm text-muted">
            Top segmentos:{' '}
            {summary.top_segments
              .map((row) => `${row.label} (${row.total})`)
              .join(' · ')}
          </p>
        ) : null}

        <p className="text-sm text-muted">
          Selecciona un segmento de la lista o crea uno nuevo.
        </p>
      </div>
    </WaEmptyPane>
  )
}
