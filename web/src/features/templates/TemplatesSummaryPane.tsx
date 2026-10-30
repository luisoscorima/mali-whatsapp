import { useEffect, useState } from 'react'
import { useAppUser } from '@/app/appOutletContext'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { MetricsGrid } from '../campaigns/MetricsGrid'
import type { MetricCard } from '../campaigns/campaignMetricActions'

type TemplateSummary = {
  kpis: MetricCard[]
}

export function TemplatesSummaryPane() {
  const user = useAppUser()
  const area = user?.area
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
            Selecciona una plantilla de la lista.
          </p>
        </div>
        <MetricsGrid title="Inventario" metrics={summary.kpis} />
        <p className="text-sm text-muted">
          Selecciona una plantilla de la lista o sincroniza desde Meta.
        </p>
      </div>
    </WaEmptyPane>
  )
}
