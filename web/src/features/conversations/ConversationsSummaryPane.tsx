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
import { apiClient } from '@/shared/api'
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

type ConversationsSummaryPaneProps = {
  collapsed?: boolean
}

export function ConversationsSummaryPane({ collapsed = false }: ConversationsSummaryPaneProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [summary, setSummary] = useState<ConversationSummary | null>(null)
  const [assignees, setAssignees] = useState<Assignee[]>([])
  const [error, setError] = useState('')
  const [open, setOpen] = useState(!collapsed)

  const days = Number(searchParams.get('kpi_days') ?? 30) || 30
  const advisorId = searchParams.get('kpi_advisor') ?? ''

  useEffect(() => {
    void apiClient.get<{ assignees: Assignee[] }>('/api/conversations/assignees').then((res) => {
      if (res.ok) setAssignees(res.data.assignees)
    })
  }, [])

  useEffect(() => {
    const qs = new URLSearchParams({ days: String(days) })
    if (advisorId) qs.set('advisor_id', advisorId)
    void apiClient.get<ConversationSummary>(`/api/conversations/summary?${qs}`).then((res) => {
      if (!res.ok) setError(res.error)
      else {
        setSummary(res.data)
        setError('')
      }
    })
  }, [days, advisorId])

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

  if (!open) {
    return (
      <div className="border-b border-line px-3 py-2">
        <button type="button" className="small-btn w-full" onClick={() => setOpen(true)}>
          Ver KPIs
        </button>
      </div>
    )
  }

  return (
    <div className="border-b border-line px-3 py-2 space-y-2 max-h-[42vh] overflow-y-auto">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted">KPIs conversaciones</span>
        <button type="button" className="small-btn text-xs" onClick={() => setOpen(false)}>
          Ocultar
        </button>
      </div>
      <div className="flex flex-wrap gap-1 text-xs">
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
            {n}d
          </button>
        ))}
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
          className="rounded border border-line bg-bg px-1 py-0.5"
        >
          <option value="">Todos los asesores</option>
          {assignees.map((a) => (
            <option key={a.id} value={String(a.id)}>
              {a.label}
            </option>
          ))}
        </select>
      </div>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
      {!summary ? (
        <p className="text-xs text-muted">Cargando KPIs…</p>
      ) : (
        <>
          <MetricsGrid
            title=""
            metrics={summary.kpis}
            onMetricClick={(metric) => applyKpiFilter(metric)}
          />
          {chartData.length > 0 ? (
            <div className="h-36 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted)" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 10 }} stroke="var(--muted)" />
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
          {summary.top_advisors.length > 0 ? (
            <p className="text-xs text-muted">
              Top asesores:{' '}
              {summary.top_advisors
                .map((row) => `${row.label} (${row.count})`)
                .join(' · ')}
            </p>
          ) : null}
        </>
      )}
    </div>
  )
}
