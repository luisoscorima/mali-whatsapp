import { type FormEvent, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { SegmentColorPicker } from './SegmentColorPicker'
import { notifySegmentsListRefresh } from './segmentsListEvents'
import { categoryLabel, categoryToSave, draftCategorySlug, useCategoryScope } from '@/shared/area/useCategoryScope'
export function SegmentNewPage() {
  const navigate = useNavigate()
  const scope = useCategoryScope()
  const [slug, setSlug] = useState('')
  const [label, setLabel] = useState('')
  const [colorKey, setColorKey] = useState('teal')
  const [saving, setSaving] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const result = await apiClient.post<{ id: number }>('/api/segments', {
      slug,
      label,
      color_key: colorKey,
      category: categoryToSave(scope),
    })
    setSaving(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notifySegmentsListRefresh()
    navigate(`/segments/${result.data.id}`)
  }

  return (
    <div className="space-y-4">
      <div>
        <Link to="/segments" className="text-sm text-accent hover:underline">
          ← Segmentos
        </Link>
        <h1 className="mt-2 flex flex-wrap items-center gap-2 text-2xl font-semibold">
          Añadir segmento
          {draftCategorySlug(scope) ? (
            <span className="rounded bg-accent-soft px-1.5 text-[10px] text-accent">
              {categoryLabel(draftCategorySlug(scope))}
            </span>
          ) : null}
        </h1>
        {draftCategorySlug(scope) === 'general' && categoryToSave(scope) === undefined ? (
          <p className="text-sm text-muted">Con varias categorías marcadas se guarda en General.</p>
        ) : null}
      </div>

      <form
        onSubmit={onSubmit}
        className="max-w-lg space-y-4 rounded-xl border border-line bg-surface-strong p-4"
      >
        <label className="block text-sm">
          <span className="text-muted">Slug</span>
          <input
            type="text"
            required
            pattern="[a-z0-9_]{1,50}"
            maxLength={50}
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="ej.: vip_cliente"
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono"
          />
        </label>

        <label className="block text-sm">
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

        <SegmentColorPicker
          label="Color en conversaciones"
          value={colorKey}
          onChange={setColorKey}
        />

        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {saving ? 'Creando…' : 'Añadir segmento'}
        </button>
      </form>
    </div>
  )
}
