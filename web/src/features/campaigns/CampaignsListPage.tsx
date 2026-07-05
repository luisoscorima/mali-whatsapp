import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaMainPane } from '@/shared/ui/shell/WaMainPane'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { CampaignListSidebar } from './CampaignListSidebar'
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

export function CampaignsListPage() {
  const [summary, setSummary] = useState<CampaignSummary | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiClient.get<CampaignSummary>('/api/campaigns/summary').then((result) => {
      if (!result.ok) setError(result.error)
      else setSummary(result.data)
    })
  }, [])

  return (
    <WaPageContents>
      <CampaignListSidebar />
      <WaMainPane>
        {error ? (
          <WaEmptyPane heading={error} />
        ) : !summary ? (
          <WaEmptyPane heading="Cargando resumen…" />
        ) : (
          <WaEmptyPane variant="history">
            <div className="space-y-4">
              <MetricsGrid title="Negocio" metrics={summary.business} />
              <MetricsGrid title="Resultado global" metrics={summary.results} />
              <p className="text-xs text-muted">
                {summary.hint} Campañas visibles: <strong>{summary.campaignsCount}</strong>.
              </p>
              <p className="text-sm text-muted">
                Selecciona una campaña de la lista o{' '}
                <Link to="/campaigns/new" className="text-accent">
                  crea una nueva
                </Link>
                .
              </p>
            </div>
          </WaEmptyPane>
        )}
      </WaMainPane>
    </WaPageContents>
  )
}
