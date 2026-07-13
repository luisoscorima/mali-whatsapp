import { useEffect, useState } from 'react'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'

type IntegrationData = {
  app_base_url: string
  webhook_url: string
  health_url: string
  dashboard_api_url: string
}

export function SettingsIntegrationPage() {
  const [data, setData] = useState<IntegrationData | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)

  useEffect(() => {
    apiClient.get<IntegrationData>('/api/settings/integration').then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        setLoadFailed(true)
        return
      }
      setData(result.data)
    })
  }, [])

  if (loadFailed) {
    return <p className="text-muted">No se pudieron cargar los datos de integración.</p>
  }

  if (!data) {
    return <p className="text-muted">Cargando…</p>
  }

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
      <h2 className="text-lg font-semibold">Integración</h2>
      <div className="space-y-3 text-sm">
        <div>
          <p className="text-muted">Webhook</p>
          <code className="mt-1 block break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs">
            {data.webhook_url}
          </code>
        </div>
        <p className="text-muted">
          <a href={data.health_url} className="text-accent" target="_blank" rel="noreferrer">
            Salud
          </a>
          {' · '}
          <a href={data.dashboard_api_url} className="text-accent" target="_blank" rel="noreferrer">
            API panel (JSON)
          </a>
        </p>
      </div>
      <details className="text-sm text-muted">
        <summary className="cursor-pointer font-medium text-ink">
          Documentación
        </summary>
        <p className="mt-2">
          En el repo: <code>CONFIGURACION_META.md</code> (Meta, webhooks),{' '}
          <code>DESPLIEGUE_PRODUCCION_APP.md</code> y{' '}
          <code>ARRANQUE_V2.md</code> para el stack v2. La URL pública viene de{' '}
          <code>APP_BASE_URL</code> en <code>.env</code>.
        </p>
      </details>
    </section>
  )
}
