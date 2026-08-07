import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useSearchParams } from 'react-router-dom'
import { useAppUser } from '@/app/appOutletContext'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { chartTooltipProps } from '@/shared/charts/chartTooltip'
import { MetricsGrid } from '../campaigns/MetricsGrid'
import type { MetricCard } from '../campaigns/campaignMetricActions'
import { SEGMENT_NONE } from '../segments/SegmentFilterChips'

type ContactSummary = {
  days: number
  kpis: MetricCard[]
  daily_series: { date: string; count: number }[]
}

const KPI_FILTER_MAP: Record<string, { segment?: string }> = {
  'Sin segmento': { segment: SEGMENT_NONE },
}

export function ContactsSummaryPane() {
  const user = useAppUser()
  const area = user?.area
  const [searchParams, setSearchParams] = useSearchParams()
  const [summary, setSummary] = useState<ContactSummary | null>(null)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  const days = Number(searchParams.get('kpi_days') ?? 30) || 30

  useEffect(() => {
    if (!area) return
    setSummary(null)
    setError('')
    let cancelled = false
    const qs = new URLSearchParams({ days: String(days) })
    void apiClient.get<ContactSummary>(`/api/contacts/summary?${qs}`).then((res) => {
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

  const chartData = useMemo(
    () =>
      (summary?.daily_series ?? []).map((point) => ({
        ...point,
        label: point.date.slice(5),
      })),
    [summary],
  )

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
    if (!mapping?.segment) return
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      next.delete('segment')
      next.append('segment', mapping.segment!)
      next.delete('page')
      return next
    })
  }

  if (user && !user.isProvisioned && !user.isMaster) {
    return (
      <WaEmptyPane
        heading="Cuenta sin permisos"
        text="Tu cuenta está activa, pero aún no tiene áreas ni permisos asignados. Un administrador debe configurarte el acceso en Admin → Usuarios."
      />
    )
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
          <h2 className="text-lg font-semibold">Contactos</h2>
          <p className="text-sm text-muted">
            Selecciona un contacto de la lista o usa un KPI para filtrar.
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

        {chartData.length > 0 ? (
          <div className="h-56 w-full rounded-xl border border-line bg-surface-strong p-4">
            <p className="mb-2 text-sm font-medium text-muted">Altas diarias</p>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <Tooltip {...chartTooltipProps} />
                <Line
                  type="monotone"
                  dataKey="count"
                  stroke="var(--accent)"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : null}

        <p className="text-sm text-muted">
          Selecciona un contacto de la lista o usa el botón + para añadir uno nuevo,
          importar o exportar.
        </p>
      </div>
    </WaEmptyPane>
  )
}
