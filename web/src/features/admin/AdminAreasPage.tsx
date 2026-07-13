import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { areaLabel } from './areaLabels'

type AdminAreaSummary = {
  slug: string
  label: string
  users: number
  contacts: number
  campaigns: number
  segments: number
}

export function AdminAreasPage() {
  const navigate = useNavigate()
  const [areas, setAreas] = useState<AdminAreaSummary[] | null>(null)
  const [currentArea, setCurrentArea] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [switching, setSwitching] = useState<string | null>(null)

  function load() {
    void Promise.all([
      apiClient.get<AdminAreaSummary[]>('/api/admin/areas'),
      apiClient.getMe(),
    ]).then(([areasRes, meRes]) => {
      if (!areasRes.ok) {
        setError(areasRes.error)
        return
      }
      setAreas(areasRes.data)
      if (meRes.ok) setCurrentArea(meRes.data.area)
    })
  }

  useEffect(() => {
    load()
  }, [])

  async function onActivate(slug: string) {
    setSwitching(slug)
    setError('')
    const result = await apiClient.switchArea(slug)
    setSwitching(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setCurrentArea(slug)
    navigate('/conversations', { replace: true })
  }

  if (error && !areas) {
    return <p className="text-bad">{error}</p>
  }

  if (!areas) {
    return <p className="text-muted">Cargando áreas…</p>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Resumen por área y cambio rápido de área activa para el usuario master.
      </p>
      {error ? <p className="text-bad">{error}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-surface-strong text-left">
            <tr>
              <th className="px-4 py-2">Área</th>
              <th className="px-4 py-2">Usuarios</th>
              <th className="px-4 py-2">Contactos</th>
              <th className="px-4 py-2">Segmentos</th>
              <th className="px-4 py-2">Campañas</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {areas.map((area) => (
              <tr key={area.slug} className="border-b border-line last:border-0">
                <td className="px-4 py-2">
                  {area.label}{' '}
                  <code className="text-xs text-muted">({area.slug})</code>
                </td>
                <td className="px-4 py-2">{area.users}</td>
                <td className="px-4 py-2">{area.contacts}</td>
                <td className="px-4 py-2">{area.segments}</td>
                <td className="px-4 py-2">{area.campaigns}</td>
                <td className="px-4 py-2">
                  {currentArea === area.slug ? (
                    <span className="badge sent">Activa</span>
                  ) : (
                    <button
                      type="button"
                      className="small-btn secondary"
                      disabled={switching === area.slug}
                      onClick={() => void onActivate(area.slug)}
                    >
                      {switching === area.slug ? '…' : 'Activar'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">
        Área actual: <strong>{currentArea ? areaLabel(currentArea) : '—'}</strong>
      </p>
    </div>
  )
}
