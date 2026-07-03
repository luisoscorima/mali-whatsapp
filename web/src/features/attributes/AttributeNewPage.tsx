import { type FormEvent, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'

type SegmentOption = {
  slug: string
  label: string
}

export function AttributeNewPage() {
  const navigate = useNavigate()
  const [segments, setSegments] = useState<SegmentOption[]>([])
  const [scope, setScope] = useState<'area' | 'segment'>('area')
  const [segmentSlug, setSegmentSlug] = useState('')
  const [slug, setSlug] = useState('')
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState('text')
  const [sortOrder, setSortOrder] = useState(0)
  const [required, setRequired] = useState(false)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiClient
      .get<SegmentOption[]>('/api/attribute-definitions/segments')
      .then((result) => {
        if (result.ok) setSegments(result.data)
      })
  }, [])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const result = await apiClient.post<{ id: number }>('/api/attribute-definitions', {
      scope,
      segment_slug: scope === 'segment' ? segmentSlug : undefined,
      slug,
      label,
      field_type: fieldType,
      sort_order: sortOrder,
      required,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate(`/attributes/${result.data.id}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/attributes" className="text-sm text-accent hover:underline">
          ← Atributos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Nuevo atributo</h1>
      </div>

      {error ? <p className="text-bad">{error}</p> : null}

      <form
        onSubmit={onSubmit}
        className="max-w-lg space-y-4 rounded-xl border border-line bg-surface-strong p-4"
      >
        <fieldset className="space-y-2 text-sm">
          <legend className="font-medium">Ámbito</legend>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === 'area'}
              onChange={() => setScope('area')}
            />
            Todo el área
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="scope"
              checked={scope === 'segment'}
              onChange={() => setScope('segment')}
            />
            Solo un segmento
          </label>
        </fieldset>

        {scope === 'segment' ? (
          <label className="block text-sm">
            <span className="text-muted">Segmento</span>
            <select
              value={segmentSlug}
              onChange={(e) => setSegmentSlug(e.target.value)}
              required
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
            >
              <option value="">—</option>
              {segments.map((s) => (
                <option key={s.slug} value={s.slug}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <label className="block text-sm">
          <span className="text-muted">Identificador (slug)</span>
          <input
            type="text"
            required
            pattern="[a-z0-9_]+"
            maxLength={64}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="codigo_alumno"
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono"
          />
        </label>

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
          Obligatorio al guardar contacto
        </label>

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {saving ? 'Creando…' : 'Crear atributo'}
        </button>
      </form>
    </div>
  )
}
