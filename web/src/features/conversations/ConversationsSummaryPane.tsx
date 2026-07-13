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
import { MetricsGrid } from '../campaigns/MetricsGrid'
import type { MetricCard } from '../campaigns/campaignMetricActions'

type ConversationSummary = {
  days: number
  advisor_id: number | null
  kpis: MetricCard[]
  daily_series: { date: string; count: number }[]
  top_advisors: { user_id: number; label: string; count: number }[]
}

type Assignee = { id: number; label: string }

const KPI_FILTER_MAP: Record<string, { chat?: string }> = {
  'Sin asignar': { chat: 'unassigned' },
  Nuevo: { chat: 'new' },
  'Sin leer': { chat: 'unread' },
  'Modo Bot': { chat: 'bot' },
  'Modo Asesor': { chat: 'human' },
}

export function ConversationsSummaryPane() {
  const user = useAppUser()
  const canViewGlobal = Boolean(user?.canViewConversationStats)
  const [searchParams, setSearchParams] = useSearchParams()
  const [summary, setSummary] = useState<ConversationSummary | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [error, setError] = useState('')

  const days = Number(searchParams.get('kpi_days') ?? 30) || 30
  const advisorId = canViewGlobal ? (searchParams.get('kpi_advisor') ?? '') : ''

  useEffect(() => {
    if (!canViewGlobal) {
      setAssignees([])
      return
    }
    void apiClient.get<{ assignees: Assignee[] }>('/api/conversations/assignees').then((res) => {
      if (res.ok) setAssignees(res.data.assignees)
    })
  }, [canViewGlobal])

  useEffect(() => {
    if (!user) return
    const qs = new URLSearchParams({ days: String(days) })
    if (canViewGlobal && advisorId) qs.set('advisor_id', advisorId)
    void apiClient.get<ConversationSummary>(`/api/conversations/summary?${qs}`).then((res) => {
      if (!res.ok) {
        notify.error(res.error)
        setError(res.error)
      } else {
        setSummary(res.data)
        setError('')
      }
    })
  }, [days, advisorId, canViewGlobal, user])

  const chartData = useMemo(
    () =>
      (summary?.daily_series ?? []).map((point) => ({
        ...point,
        label: point.date.slice(5),
      })),
    [summary],
  )

  function applyKpiFilter(metric: MetricCard) {
    const mapping = KPI_FILTER_MAP[metric.label]
    if (!mapping?.chat) return
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      next.set('chat', mapping.chat!)
      next.delete('id')
      return next
    })
  }

  if (error) {
    return <WaEmptyPane heading="No se pudo cargar" />
  }

  if (!user || !summary) {
    return <WaEmptyPane heading="Cargando resumen…" />
  }

  return (
    <WaEmptyPane variant="history">
      <div className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Conversaciones</h2>
          <p className="text-sm text-muted">
            {canViewGlobal
              ? 'Selecciona un chat de la lista o usa un KPI para filtrar el inbox.'
              : 'Resumen de tus conversaciones asignadas. Selecciona un chat de la lista.'}
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
          {canViewGlobal ? (
            <select
              value={advisorId}
              onChange={(e) =>
                setSearchParams((sp) => {
                  const next = new URLSearchParams(sp)
                  const v = e.target.value
                  if (v) next.set('kpi_advisor', v)
                  else next.delete('kpi_advisor')
                  return next
                })
              }
              className="rounded-lg border border-line bg-bg px-2 py-1"
            >
              <option value="">Todos los asesores</option>
              {assignees.map((a) => (
                <option key={a.id} value={String(a.id)}>
                  {a.label}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        <MetricsGrid
          title={canViewGlobal ? 'Resumen' : 'Mi resumen'}
          metrics={summary.kpis}
          onMetricClick={(metric) => applyKpiFilter(metric)}
        />

        {chartData.length > 0 ? (
          <div className="h-56 w-full rounded-xl border border-line bg-surface-strong p-4">
            <p className="mb-2 text-sm font-medium text-muted">Actividad diaria</p>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted)" />
                <Tooltip />
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

        {canViewGlobal && summary.top_advisors.length > 0 ? (
          <p className="text-sm text-muted">
            Top asesores:{' '}
            {summary.top_advisors.map((row) => `${row.label} (${row.count})`).join(' · ')}
          </p>
        ) : null}
      </div>
    </WaEmptyPane>
  )
}
