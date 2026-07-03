import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { MetricsGrid } from './MetricsGrid'
import { campaignStatusClass } from './campaignStatus'

type MetricCard = {
  label: string
  display: string
  displayLines?: string[] | null
  tone?: string
  tooltip?: string
}

type CampaignListItem = {
  id: number
  segment_display: string
  template_name: string
  status: string
  total_recipients: number
  scheduled_at: string | null
  first_send_at: string | null
  sent_percent: number | null
  sent_ratio: string
}

type CampaignSummary = {
  business: MetricCard[]
  results: MetricCard[]
  hint: string
  campaignsCount: number
}

export function CampaignsListPage() {
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null)
  const [summary, setSummary] = useState<CampaignSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      apiClient.get<CampaignListItem[]>('/api/campaigns'),
      apiClient.get<CampaignSummary>('/api/campaigns/summary'),
    ]).then(([listResult, summaryResult]) => {
      if (!listResult.ok) {
        setError(listResult.error)
        return
      }
      if (!summaryResult.ok) {
        setError(summaryResult.error)
        return
      }
      setCampaigns(listResult.data)
      setSummary(summaryResult.data)
    })
  }, [])

  if (error) {
    return <p className="text-bad">{error}</p>
  }

  if (!campaigns || !summary) {
    return <p className="text-muted">Cargando campañas…</p>
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Campañas</h1>
          <p className="text-sm text-muted">
            Envíos masivos de plantillas WhatsApp a segmentos.
          </p>
        </div>
        <Link
          to="/campaigns/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90"
        >
          Nueva campaña
        </Link>
      </div>

      <div className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
        <MetricsGrid title="Negocio" metrics={summary.business} />
        <MetricsGrid title="Resultado global" metrics={summary.results} />
        <p className="text-xs text-muted">
          {summary.hint} Campañas visibles:{' '}
          <strong>{summary.campaignsCount}</strong>.
        </p>
      </div>

      {campaigns.length === 0 ? (
        <p className="text-sm text-muted">
          No hay campañas en esta área.{' '}
          <Link to="/campaigns/new" className="text-accent">
            Crear la primera
          </Link>
          .
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface-strong">
          {campaigns.map((c) => {
            const sendWhen = c.first_send_at || c.scheduled_at
            return (
              <li key={c.id}>
                <Link
                  to={`/campaigns/${c.id}`}
                  className="block px-4 py-3 hover:bg-accent-soft"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">
                      #{c.id} · {c.template_name || '—'}
                    </span>
                    <span className="flex items-center gap-2">
                      {c.sent_percent !== null ? (
                        <span className="text-xs text-muted">{c.sent_percent}%</span>
                      ) : null}
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${campaignStatusClass(c.status)}`}
                      >
                        {c.status}
                      </span>
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-sm text-muted">
                    {c.segment_display || '—'}
                  </p>
                  <p className="mt-1 text-sm text-muted">
                    {c.sent_ratio} enviados
                    {sendWhen
                      ? ` · ${formatDateTime(sendWhen).split(',')[0]}`
                      : ''}
                  </p>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
