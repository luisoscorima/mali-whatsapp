import { useEffect, useState } from 'react'
import { apiClient } from '../../shared/api'
import { WaSpanMainPage } from '@/shared/ui/shell/WaSpanMainPage'

type DashboardData = {
  contacts: Array<{ id: number; name: string | null; phone: string }>
  campaigns: Array<{ id: number; segment: string; template_name: string; status: string }>
  stats: Array<{ segment: string; total: number }>
  campaignTotals: { total_logs: number }
}

export function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [health, setHealth] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    async function load() {
      const me = await apiClient.getMe()
      if (me.ok && !me.data.isProvisioned && !me.data.isMaster) {
        setPending(true)
        return
      }

      const [dashboard, healthResult] = await Promise.all([
        apiClient.get<DashboardData>('/api/dashboard'),
        apiClient.getHealth(),
      ])
      if (!dashboard.ok) {
        setError(dashboard.error)
        return
      }
      setData(dashboard.data)
      setHealth(
        healthResult.ok
          ? `API ${healthResult.db === 'up' ? 'conectada a BD' : 'activa'}`
          : healthResult.error || 'API no disponible',
      )
    }
    load()
  }, [])

  if (pending) {
    return (
      <WaSpanMainPage title="Panel">
        <p className="text-sm text-muted">
          Tu cuenta está activa, pero aún no tiene áreas ni permisos asignados.
          Un administrador debe configurarte el acceso en Admin → Usuarios.
        </p>
      </WaSpanMainPage>
    )
  }

  if (error) {
    return (
      <WaSpanMainPage title="Panel">
        <p className="text-bad">{error}</p>
      </WaSpanMainPage>
    )
  }

  if (!data) {
    return (
      <WaSpanMainPage title="Panel">
        <p className="text-muted">Cargando panel…</p>
      </WaSpanMainPage>
    )
  }

  return (
    <WaSpanMainPage>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">Panel</h1>
          {health ? <p className="text-sm text-muted">{health}</p> : null}
        </div>

        <section className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-line bg-surface-strong p-4">
            <p className="text-sm text-muted">Contactos recientes</p>
            <p className="text-2xl font-semibold">{data.contacts.length}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-strong p-4">
            <p className="text-sm text-muted">Campañas recientes</p>
            <p className="text-2xl font-semibold">{data.campaigns.length}</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-strong p-4">
            <p className="text-sm text-muted">Logs de campaña</p>
            <p className="text-2xl font-semibold">{data.campaignTotals.total_logs}</p>
          </div>
        </section>

        <section className="rounded-xl border border-line bg-surface-strong p-4">
          <h2 className="mb-3 font-medium">Segmentos activos</h2>
          {data.stats.length === 0 ? (
            <p className="text-sm text-muted">Sin segmentos con contactos activos.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.stats.map((row) => (
                <li key={row.segment} className="flex justify-between gap-4">
                  <span>{row.segment}</span>
                  <span className="text-muted">{row.total}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </WaSpanMainPage>
  )
}
