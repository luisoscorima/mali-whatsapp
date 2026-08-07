import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAppUser } from '@/app/appOutletContext'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { MetricsGrid } from '../campaigns/MetricsGrid'
import type { MetricCard } from '../campaigns/campaignMetricActions'

type FlowSummary = {
  kpis: MetricCard[]
}

export function FlowsSummaryPane() {
  const user = useAppUser()
  const area = user?.area
  const [summary, setSummary] = useState<FlowSummary | null>(null)
  const [error, setError] = useState('')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    if (!area) return
    setSummary(null)
    setError('')
    let cancelled = false
    void apiClient.get<FlowSummary>('/api/flows/summary').then((res) => {
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
          <h2 className="text-lg font-semibold">Respuestas automatizadas</h2>
          <p className="text-sm text-muted">
            Resumen del área. El detalle por paso está en cada flujo.
          </p>
        </div>
        <MetricsGrid title="Resumen" metrics={summary.kpis} />
        <p className="text-sm text-muted">
          Configura flujos que se activan con el payload de un botón QUICK_REPLY o
          interactivo. Prioridad: flujo → fuera de horario → IA.
        </p>
        <Link to="/flows/new" className="small-btn primary inline-block">
          Crear flujo
        </Link>
      </div>
    </WaEmptyPane>
  )
}
