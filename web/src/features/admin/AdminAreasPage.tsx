import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { canonicalArea } from '@/shared/area/category-selection'
import { areaLabel } from './areaLabels'

type AdminCategorySummary = {
  slug: string
  label: string
  segments: number
  campaigns: number
  flows: number
  attributes: number
  leads: number
}

type AdminAreaSummary = {
  slug: string
  label: string
  users: number
  contacts: number
  campaigns: number
  segments: number
  categories?: AdminCategorySummary[]
  review_contacts?: number
  consolidation_reviews?: number
  identity_reviews?: number
}

export function AdminAreasPage() {
  const navigate = useNavigate()
  const [areas, setAreas] = useState<AdminAreaSummary[] | null>(null)
  const [currentArea, setCurrentArea] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)

  function load() {
    void Promise.all([
      apiClient.get<AdminAreaSummary[]>('/api/admin/areas'),
      apiClient.getMe(),
    ]).then(([areasRes, meRes]) => {
      if (!areasRes.ok) {
        notify.error(areasRes.error)
        setLoadFailed(true)
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
    const result = await apiClient.switchArea(slug)
    setSwitching(null)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setCurrentArea(slug)
    navigate('/conversations', { replace: true })
  }

  if (loadFailed) {
    return <p className="text-muted">No se pudo cargar</p>
  }

  if (!areas) {
    return <p className="text-muted">Cargando áreas…</p>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Cuatro áreas. En Educación, General, CA y EP son categorías de la misma ficha.
      </p>
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
                  {area.categories?.length ? (
                    <ul className="mt-2 space-y-1 text-xs text-muted">
                      {area.categories.map((category) => (
                        <li key={category.slug}>
                          {category.label}: {category.segments} segmentos · {category.campaigns}{' '}
                          campañas · {category.flows} flujos · {category.attributes} atributos ·{' '}
                          {category.leads} leads
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {area.consolidation_reviews || area.review_contacts || area.identity_reviews ? (
                    <p className="mt-2 text-xs text-muted">
                      Sin fusionar: {area.consolidation_reviews ?? 0} en revisión
                      {area.review_contacts ? ` · ${area.review_contacts} fichas aún en CA/EP` : ''}
                      {area.identity_reviews
                        ? ` · ${area.identity_reviews} conflictos de identidad`
                        : ''}
                    </p>
                  ) : null}
                </td>
                <td className="px-4 py-2">{area.users}</td>
                <td className="px-4 py-2">{area.contacts}</td>
                <td className="px-4 py-2">{area.segments}</td>
                <td className="px-4 py-2">{area.campaigns}</td>
                <td className="px-4 py-2">
                  {currentArea && canonicalArea(currentArea) === area.slug ? (
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
