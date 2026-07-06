import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { MetricsGrid } from './MetricsGrid'

type MetricCard = {
  label: string
  display: string
  displayLines?: string[] | null
  tone?: string
  tooltip?: string
}

type CampaignSummary = {
  business: MetricCard[]
  results: MetricCard[]
  hint: string
  campaignsCount: number
}

export function CampaignsSummaryPane() {
  const [summary, setSummary] = useState<CampaignSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiClient.get<CampaignSummary>('/api/campaigns/summary').then((result) => {
      if (!result.ok) setError(result.error)
      else setSummary(result.data)
    })
  }, [])

  if (error) {
    return <WaEmptyPane heading={error} />
  }

  if (!summary) {
    return <WaEmptyPane heading="Cargando resumen…" />
  }

  return (
    <WaEmptyPane variant="history">
      <div className="space-y-4">
        <MetricsGrid title="Negocio" metrics={summary.business} />
        <MetricsGrid title="Resultado global" metrics={summary.results} />
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
