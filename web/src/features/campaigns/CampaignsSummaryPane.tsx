import { useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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
import { MetricsGrid } from './MetricsGrid'

type MetricCard = {
  label: string
  display: string
  displayLines?: string[] | null
  tone?: string
  tooltip?: string
}

type MonthlyPoint = {
  monthKey: string
  label: string
  campaignsCount: number
  costUsd: number
}

type CampaignSummary = {
  business: MetricCard[]
  results: MetricCard[]
  hint: string
  campaignsCount: number
  monthlySeries?: MonthlyPoint[]
}

export function CampaignsSummaryPane() {
  const user = useAppUser()
  const canViewStats = Boolean(user?.canViewCampaignStats)
  const [searchParams] = useSearchParams()
  const month = searchParams.get('month') ?? ''
  const [summary, setSummary] = useState<CampaignSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!canViewStats) return
    setSummary(null)
    setError('')
    let cancelled = false
    const qs = month ? `?month=${encodeURIComponent(month)}` : ''
    void apiClient.get<CampaignSummary>(`/api/campaigns/summary${qs}`).then((result) => {
      if (cancelled) return
      if (!result.ok) {
        notify.error(result.error)
        setError(result.error)
      } else {
        setSummary(result.data)
      }
    })
    return () => {
      cancelled = true
    }
  }, [canViewStats, month])

  if (user && !canViewStats) {
    return (
      <WaEmptyPane
        heading="Campañas"
        text="Selecciona una campaña de la lista o crea una nueva."
      />
    )
  }

  if (error) {
    return <WaEmptyPane heading="No se pudo cargar" />
  }

  if (!summary) {
    return <WaEmptyPane heading="Cargando resumen…" />
  }

  const chartData = !month ? summary.monthlySeries ?? [] : []
  const showChart = chartData.length > 0

  return (
    <WaEmptyPane variant="history">
      <div className="space-y-4">
        <MetricsGrid title="Negocio" metrics={summary.business} />
        <MetricsGrid title="Resultado global" metrics={summary.results} />
        {showChart ? (
          <div className="h-64 w-full rounded-xl border border-line bg-surface-strong p-4">
            <p className="mb-2 text-sm font-medium text-muted">
              Gasto y campañas por mes
            </p>
            <ResponsiveContainer width="100%" height="85%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <YAxis
                  yAxisId="campaigns"
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted)"
                />
                <YAxis
                  yAxisId="cost"
                  orientation="right"
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted)"
                  tickFormatter={(v: number) => `$${v}`}
                />
                <Tooltip
                  formatter={(value, name) => {
                    const n = Number(value) || 0
                    if (name === 'Gasto USD') {
                      return [`$${n.toFixed(2)}`, name]
                    }
                    return [n, name]
                  }}
                />
                <Legend />
                <Bar
                  yAxisId="campaigns"
                  dataKey="campaignsCount"
                  name="Campañas"
                  fill="var(--accent)"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  yAxisId="cost"
                  dataKey="costUsd"
                  name="Gasto USD"
                  fill="var(--muted)"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : null}
        <p className="text-xs text-muted">
          {summary.hint} Campañas visibles: <strong>{summary.campaignsCount}</strong>.
        </p>
        <p className="text-sm text-muted">
          Selecciona una campaña de la lista o crea una nueva.
        </p>
      </div>
    </WaEmptyPane>
  )
}
