import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { ModulePageHeader } from '@/shared/ui/ModulePageHeader'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'
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
  const { confirm, confirmDialog } = useConfirmDialog()
  const [areas, setAreas] = useState<AdminAreaSummary[] | null>(null)
  const [currentArea, setCurrentArea] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null)
  const [categorySlug, setCategorySlug] = useState('')
  const [categoryLabel, setCategoryLabel] = useState('')
  const [categoryBusy, setCategoryBusy] = useState(false)
  const [catalogArea, setCatalogArea] = useState('educacion')
  const [catalog, setCatalog] = useState<{ slug: string; label: string; active: boolean; lines: number }[]>([])

  function load(catalogSlug = catalogArea) {
    void Promise.all([
      apiClient.get<AdminAreaSummary[]>('/api/admin/areas'),
      apiClient.get<{ slug: string; label: string; active: boolean; lines: number }[]>(
        `/api/admin/areas/${encodeURIComponent(catalogSlug)}/categories`,
      ),
      apiClient.getMe(),
    ]).then(([areasRes, catalogRes, meRes]) => {
      if (!areasRes.ok) {
        notify.error(areasRes.error)
        setLoadFailed(true)
        return
      }
      setAreas(areasRes.data)
      if (catalogRes.ok) setCatalog(catalogRes.data)
      else setCatalog([])
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

  async function onDeactivateCategory(item: { slug: string; label: string }) {
    const ok = await confirm({
      title: 'Dar de baja categoría',
      description: `¿Dar de baja «${item.label}»? Dejará de aparecer en altas nuevas.`,
      confirmLabel: 'Dar de baja',
      tone: 'danger',
    })
    if (!ok) return
    const result = await apiClient.patch(
      `/api/admin/areas/${encodeURIComponent(catalogArea)}/categories/${item.slug}`,
      { active: false },
    )
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success('Categoría dada de baja')
    load()
  }

  if (loadFailed) {
    return <p className="text-muted">No se pudo cargar</p>
  }

  if (!areas) {
    return <p className="text-muted">Cargando áreas…</p>
  }

  return (
    <div className="space-y-4">
      {confirmDialog}
      <ModulePageHeader
        title="Áreas"
        description="Cada área puede tener categorías (productos). General no es una fila: es la ausencia de categoría."
      />

      <section className="space-y-3 rounded-xl border border-line bg-surface-strong p-4">
        <h2 className="text-sm font-medium">Categorías del catálogo</h2>
        <label className="block text-sm">
          <span className="text-muted">Área del catálogo</span>
          <select
            className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
            value={catalogArea}
            onChange={(event) => {
              const next = event.target.value
              setCatalogArea(next)
              load(next)
            }}
          >
            {(areas ?? []).map((area) => (
              <option key={area.slug} value={area.slug}>
                {area.label}
              </option>
            ))}
          </select>
        </label>

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            setCategoryBusy(true)
            void apiClient
              .post(`/api/admin/areas/${encodeURIComponent(catalogArea)}/categories`, {
                slug: categorySlug,
                label: categoryLabel,
              })
              .then((result) => {
                setCategoryBusy(false)
                if (!result.ok) {
                  notify.error(result.error)
                  return
                }
                setCategorySlug('')
                setCategoryLabel('')
                notify.success('Categoría creada')
                load()
              })
          }}
        >
          <label className="text-sm">
            <span className="text-muted">Nueva categoría</span>
            <input
              className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
              value={categoryLabel}
              placeholder="Nombre"
              onChange={(event) => setCategoryLabel(event.target.value)}
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">Identificador</span>
            <input
              className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
              value={categorySlug}
              placeholder="hasta 10 letras"
              onChange={(event) => setCategorySlug(event.target.value)}
            />
          </label>
          <button type="submit" className="small-btn min-h-11" disabled={categoryBusy}>
            Crear
          </button>
        </form>

        {catalog.length === 0 ? (
          <p className="text-sm text-muted">No hay categorías en este catálogo.</p>
        ) : (
          <ul className="space-y-2 text-sm">
            {catalog.map((item) => (
              <li
                key={item.slug}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2"
              >
                <span>
                  {item.label}{' '}
                  <code className="text-xs text-muted">{item.slug}</code>
                  {item.active ? '' : ' · de baja'} · {item.lines} líneas activas
                </span>
                {item.slug !== 'general' && item.active ? (
                  <button
                    type="button"
                    className="small-btn secondary min-h-11"
                    onClick={() => void onDeactivateCategory(item)}
                  >
                    Dar de baja
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Resumen por área</h2>
        <p className="text-sm text-muted">
          Área actual: <strong>{currentArea ? areaLabel(currentArea) : '—'}</strong>
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
                            {category.label}: {category.segments} segmentos ·{' '}
                            {category.campaigns} campañas · {category.flows} flujos ·{' '}
                            {category.attributes} atributos · {category.leads} leads
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {area.consolidation_reviews ||
                    area.review_contacts ||
                    area.identity_reviews ? (
                      <p className="mt-2 text-xs text-muted">
                        Sin fusionar: {area.consolidation_reviews ?? 0} en revisión
                        {area.review_contacts
                          ? ` · ${area.review_contacts} fichas aún en CA/EP`
                          : ''}
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
                        className="small-btn secondary min-h-11"
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
      </section>
    </div>
  )
}
