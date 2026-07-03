import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'

type AttributeDefinition = {
  id: number
  segment_slug: string | null
  slug: string
  label: string
  field_type: string
  sort_order: number
  required: boolean
  active: boolean
}

type SegmentOption = {
  slug: string
  label: string
}

function scopeLabel(def: AttributeDefinition, segments: SegmentOption[]): string {
  if (!def.segment_slug) return 'Área'
  const seg = segments.find((s) => s.slug === def.segment_slug)
  return `Segmento · ${seg?.label ?? def.segment_slug}`
}

export function AttributeDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [def, setDef] = useState<AttributeDefinition | null>(null)
  const [segments, setSegments] = useState<SegmentOption[]>([])
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState('text')
  const [sortOrder, setSortOrder] = useState(0)
  const [required, setRequired] = useState(false)
  const [active, setActive] = useState(true)
  const [error, setError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      apiClient.get<AttributeDefinition>(`/api/attribute-definitions/${id}`),
      apiClient.get<SegmentOption[]>('/api/attribute-definitions/segments'),
    ]).then(([detail, segs]) => {
      if (!detail.ok) {
        setError(detail.error)
        return
      }
      setDef(detail.data)
      setLabel(detail.data.label)
      setFieldType(detail.data.field_type)
      setSortOrder(detail.data.sort_order)
      setRequired(detail.data.required)
      setActive(detail.data.active)
      if (segs.ok) setSegments(segs.data)
    })
  }, [id])

  async function onSave(e: FormEvent) {
    e.preventDefault()
    if (!id) return
    setSaving(true)
    setSaveMsg('')
    setError('')
    const result = await apiClient.patch<AttributeDefinition>(
      `/api/attribute-definitions/${id}`,
      {
        label,
        field_type: fieldType,
        sort_order: sortOrder,
        required,
        active,
      },
    )
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setDef(result.data)
    setSaveMsg('Guardado.')
  }

  async function onDelete() {
    if (!id) return
    if (
      !window.confirm(
        '¿Eliminar esta definición? Los valores guardados en contactos permanecen en la base de datos.',
      )
    ) {
      return
    }
    const result = await apiClient.delete(`/api/attribute-definitions/${id}`)
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate('/attributes')
  }

  if (error && !def) {
    return <p className="text-bad">{error}</p>
  }

  if (!def) {
    return <p className="text-muted">Cargando atributo…</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/attributes" className="text-sm text-accent hover:underline">
          ← Atributos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{def.label}</h1>
        <p className="font-mono text-sm text-muted">
          {def.slug} · {scopeLabel(def, segments)}
        </p>
      </div>

      {saveMsg ? <p className="text-sm text-accent">{saveMsg}</p> : null}
      {error ? <p className="text-bad">{error}</p> : null}

      <form
        onSubmit={onSave}
        className="max-w-lg space-y-4 rounded-xl border border-line bg-surface-strong p-4"
      >
        <p className="text-sm text-muted">
          El slug <code className="font-mono">{def.slug}</code> y el ámbito no se pueden
          cambiar.
        </p>

        <label className="block text-sm">
          <span className="text-muted">Etiqueta visible</span>
          <input
            type="text"
            required
            maxLength={120}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
          />
        </label>

        <label className="block text-sm">
          <span className="text-muted">Tipo</span>
          <select
            value={fieldType}
            onChange={(e) => setFieldType(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
          >
            <option value="text">Texto</option>
            <option value="number">Número</option>
            <option value="date">Fecha</option>
          </select>
        </label>

        <label className="block text-sm">
          <span className="text-muted">Orden</span>
          <input
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(Number(e.target.value))}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => setRequired(e.target.checked)}
          />
          Obligatorio
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          Activo (visible en formularios)
        </label>

        <div className="flex flex-wrap gap-3">
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
            Eliminar definición
          </button>
        </div>
      </form>
    </div>
  )
}
