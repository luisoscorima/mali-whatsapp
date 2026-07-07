import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatContactName } from '../contacts/contactName'
import { segmentToneClass } from './segmentColors'
import { SegmentColorPicker } from './SegmentColorPicker'
type SegmentDefinition = {
  id: number
  slug: string
  label: string
  sort_order: number
  color_key: string
  active: boolean
  show_in_filter: boolean
  assignable: boolean
  created_at: string
}

type SegmentMember = {
  id: number
  name: string
  last_name: string
  phone: string
  segment_slugs: string[]
}

type SegmentDetail = {
  segment: SegmentDefinition
  members: SegmentMember[]
}

export function SegmentDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [payload, setPayload] = useState<SegmentDetail | null>(null)
  const [allSegments, setAllSegments] = useState<SegmentDefinition[]>([])
  const [slug, setSlug] = useState('')
  const [label, setLabel] = useState('')
  const [sortOrder, setSortOrder] = useState(0)
  const [colorKey, setColorKey] = useState('teal')
  const [active, setActive] = useState(true)
  const [showInFilter, setShowInFilter] = useState(true)
  const [assignable, setAssignable] = useState(true)
  const [error, setError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [removingId, setRemovingId] = useState<number | null>(null)
  const [exportBusy, setExportBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      apiClient.get<SegmentDetail>(`/api/segments/${id}`),
      apiClient.get<SegmentDefinition[]>('/api/segments'),
    ]).then(([detail, list]) => {
      if (!detail.ok) {
        setError(detail.error)
        return
      }
      setPayload(detail.data)
      const seg = detail.data.segment
      setSlug(seg.slug)
      setLabel(seg.label)
      setSortOrder(seg.sort_order)
      setColorKey(seg.color_key)
      setActive(seg.active)
      setShowInFilter(seg.show_in_filter)
      setAssignable(seg.assignable)
      if (list.ok) setAllSegments(list.data)
    })
  }, [id])

  const segmentBySlug = useMemo(() => {
    const map = new Map<string, SegmentDefinition>()
    for (const seg of allSegments) {
      map.set(seg.slug, seg)
    }
    return map
  }, [allSegments])

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!id) return
    setSaving(true)
    setSaveMsg('')
    setError('')
    const result = await apiClient.patch<SegmentDefinition>(`/api/segments/${id}`, {
      slug,
      label,
      sort_order: sortOrder,
      color_key: colorKey,
      active,
      show_in_filter: showInFilter,
      assignable,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaveMsg('Segmento actualizado.')
    setPayload((prev) =>
      prev ? { ...prev, segment: { ...prev.segment, ...result.data } } : prev,
    )
    if (result.data.slug !== slug) {
      setSlug(result.data.slug)
    }
  }

  async function onDelete() {
    if (!id) return
    if (
      !window.confirm(
        '¿Borrar este segmento? Se quitará de los contactos (vínculos), no se borran las personas.',
      )
    ) {
      return
    }
    const result = await apiClient.delete(`/api/segments/${id}`)
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate('/segments')
  }

  async function onRemoveMember(contactId: number) {
    if (!id) return
    if (!window.confirm('¿Quitar este contacto del segmento?')) return
    setRemovingId(contactId)
    setError('')
    const result = await apiClient.delete<SegmentDetail>(
      `/api/segments/${id}/contacts/${contactId}`,
    )
    setRemovingId(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPayload(result.data)
  }

  async function onExport() {
    if (!id) return
    setExportBusy(true)
    setError('')
    const result = await apiClient.download(`/api/segments/${id}/export`)
    setExportBusy(false)
    if (!result.ok) setError(result.error)
  }

  if (error && !payload) {
    return <p className="text-bad">{error}</p>
  }

  if (!payload) {
    return <p className="text-muted">Cargando segmento…</p>
  }

  const { members } = payload

  return (
    <div className="space-y-6">
      <div>
        <Link to="/segments" className="text-sm text-accent hover:underline">
          ← Segmentos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{label}</h1>
        <p className="font-mono text-sm text-muted">{slug}</p>
      </div>

      {saveMsg ? <p className="text-sm text-accent">{saveMsg}</p> : null}
      {error ? <p className="text-bad">{error}</p> : null}

      <section className="rounded-xl border border-line bg-surface-strong p-4">
        <h2 className="mb-2 font-medium">Editar segmento</h2>
        <p className="mb-3 text-sm text-muted">
          Si cambias el slug, se actualizan los contactos y el histórico de campañas de
          ese segmento en esta área.
        </p>
        <form onSubmit={onSave} className="grid max-w-2xl gap-4 sm:grid-cols-2">
          <label className="block text-sm sm:col-span-1">
            <span className="text-muted">Slug</span>
            <input
              type="text"
              required
              pattern="[a-z0-9_]{1,50}"
              maxLength={50}
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono"
            />
          </label>
          <label className="block text-sm sm:col-span-1">
            <span className="text-muted">Etiqueta</span>
            <input
              type="text"
              required
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
            />
          </label>
          <label className="block text-sm sm:col-span-1">
            <span className="text-muted">Orden</span>
            <input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
            />
          </label>
          <SegmentColorPicker
            className="sm:col-span-2"
            value={colorKey}
            onChange={setColorKey}
          />
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
            />
            Activo
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-1">
            <input
              type="checkbox"
              checked={showInFilter}
              onChange={(e) => setShowInFilter(e.target.checked)}
            />
            Mostrar en filtros
          </label>
          <label className="flex items-center gap-2 text-sm sm:col-span-1">
            <input
              type="checkbox"
              checked={assignable}
              onChange={(e) => setAssignable(e.target.checked)}
            />
            Asignable desde chat
          </label>
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
            >
              {saving ? 'Guardando…' : 'Guardar cambios'}
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="rounded-lg border border-bad px-4 py-2 text-sm text-bad"
            >
              Borrar segmento
            </button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-line bg-surface-strong p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">Contactos del segmento</h2>
            <p className="text-sm text-muted">
              Revisa quién pertenece a este segmento o quita el vínculo.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line px-3 py-1 text-sm text-muted">
              {members.length} contacto(s)
            </span>
            <button
              type="button"
              disabled={exportBusy || members.length === 0}
              onClick={() => void onExport()}
              className="small-btn"
              title="Descargar Excel con los contactos de este segmento"
            >
              {exportBusy ? '…' : 'Exportar Excel'}
            </button>
          </div>
        </div>

        {members.length === 0 ? (
          <p className="text-sm text-muted">No hay contactos activos en este segmento.</p>
        ) : (
          <ul className="divide-y divide-line">
            {members.map((member) => {
              const canRemove = member.segment_slugs.length > 1
              return (
                <li
                  key={member.id}
                  className="flex flex-wrap items-start justify-between gap-3 py-3"
                >
                  <div>
                    <p className="font-medium">
                      {formatContactName(member.name, member.last_name, member.phone)}
                    </p>
                    <p className="font-mono text-sm text-muted">{member.phone}</p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {member.segment_slugs.map((segSlug) => {
                        const seg = segmentBySlug.get(segSlug)
                        return (
                          <span
                            key={segSlug}
                            className={`rounded px-2 py-0.5 text-xs ${segmentToneClass(seg?.color_key)}`}
                          >
                            {seg?.label ?? segSlug}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={!canRemove || removingId === member.id}
                    title={
                      canRemove
                        ? 'Quitar del segmento'
                        : 'El contacto debe conservar al menos un segmento'
                    }
                    onClick={() => onRemoveMember(member.id)}
                    className="rounded-lg border border-bad px-3 py-1.5 text-sm text-bad disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {removingId === member.id ? 'Quitando…' : 'Quitar'}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
