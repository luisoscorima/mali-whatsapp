import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { categoryLabel, categoryToSave, draftCategorySlug, useCategoryScope, withCategoryQuery } from '@/shared/area/useCategoryScope'
import { SearchableSelect } from '@/shared/ui/SearchableSelect'

type SegmentOption = {
  slug: string
  label: string
  category?: string
}

export function AttributeNewPage() {
  const navigate = useNavigate()
  const categories = useCategoryScope()
  const [segments, setSegments] = useState<SegmentOption[]>([])
  const [scope, setScope] = useState<'area' | 'segment'>('area')
  const [segmentSlug, setSegmentSlug] = useState('')
  const [slug, setSlug] = useState('')
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState('text')
  const [optionsText, setOptionsText] = useState('')
  const [required, setRequired] = useState(false)
  const [saving, setSaving] = useState(false)

  const segmentQuery =
    categories.query ||
    (categories.slugs?.length === 1 ? `category=${encodeURIComponent(categories.slugs[0])}` : '')

  const showSegmentCategory = useMemo(() => {
    const cats = new Set(segments.map((s) => s.category || 'general'))
    return cats.size > 1
  }, [segments])

  const segmentOptions = useMemo(
    () =>
      segments.map((s) => ({
        value: s.slug,
        label:
          categories.education &&
          segments.some(
            (other) => other.slug === s.slug && other.category !== s.category,
          )
            ? `${s.label} · ${categoryLabel(s.category)}`
            : s.label,
        group: showSegmentCategory
          ? categoryLabel(s.category)
          : undefined,
        keywords: s.slug,
      })),
    [segments, categories.education, showSegmentCategory],
  )

  useEffect(() => {
    apiClient
      .get<SegmentOption[]>(withCategoryQuery('/api/attribute-definitions/segments', segmentQuery))
      .then((result) => {
        if (result.ok) setSegments(result.data)
      })
  }, [segmentQuery])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (scope === 'segment' && !segmentSlug.trim()) {
      notify.error('Selecciona un segmento')
      return
    }
    setSaving(true)
    const options =
      fieldType === 'select'
        ? optionsText
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean)
        : undefined
    const result = await apiClient.post<{ id: number }>('/api/attribute-definitions', {
      scope,
      segment_slug: scope === 'segment' ? segmentSlug : undefined,
      slug,
      label,
      field_type: fieldType,
      options,
      required,
      category: categoryToSave(categories),
    })
    setSaving(false)
    if (!result.ok) {
      notify.error(result.error)
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
        {draftCategorySlug(categories) === 'general' && categoryToSave(categories) === undefined ? (
          <p className="text-sm text-muted">Con varias categorías marcadas se guarda en General.</p>
        ) : null}
      </div>

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
            <SearchableSelect
              className="mt-1"
              value={segmentSlug}
              onChange={setSegmentSlug}
              placeholder="—"
              searchPlaceholder="Buscar segmento…"
              clearOption={{ label: '—' }}
              aria-label="Segmento"
              options={segmentOptions}
            />
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
            <option value="select">Lista desplegable</option>
          </select>
        </label>

        {fieldType === 'select' ? (
          <label className="block text-sm">
            <span className="text-muted">Opciones (una por línea)</span>
            <textarea
              required
              rows={5}
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
              placeholder={'Sí\nNo\nOtro'}
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
            />
          </label>
        ) : null}

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
