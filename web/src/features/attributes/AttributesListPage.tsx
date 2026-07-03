import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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

export function AttributesListPage() {
  const [definitions, setDefinitions] = useState<AttributeDefinition[] | null>(null)
  const [segments, setSegments] = useState<SegmentOption[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    Promise.all([
      apiClient.get<AttributeDefinition[]>('/api/attribute-definitions'),
      apiClient.get<SegmentOption[]>('/api/attribute-definitions/segments'),
    ]).then(([defs, segs]) => {
      if (!defs.ok) {
        setError(defs.error)
        return
      }
      setDefinitions(defs.data)
      if (segs.ok) setSegments(segs.data)
    })
  }, [])

  if (error) {
    return <p className="text-bad">{error}</p>
  }

  if (!definitions) {
    return <p className="text-muted">Cargando atributos…</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Atributos de contacto</h1>
          <p className="text-sm text-muted">
            Campos para todo el área o solo para un segmento.
          </p>
        </div>
        <Link
          to="/attributes/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white"
        >
          + Nuevo atributo
        </Link>
      </div>

      {definitions.length === 0 ? (
        <p className="text-sm text-muted">
          Sin definiciones. Crea atributos del área o por segmento.
        </p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface-strong">
          {definitions.map((def) => (
            <li key={def.id}>
              <Link
                to={`/attributes/${def.id}`}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-accent-soft"
              >
                <div>
                  <p className="font-medium">
                    {def.label}
                    {!def.active ? (
                      <span className="ml-2 text-xs text-muted">(inactivo)</span>
                    ) : null}
                  </p>
                  <p className="font-mono text-xs text-muted">{def.slug}</p>
                  <p className="text-sm text-muted">
                    {scopeLabel(def, segments)} · {def.field_type}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
