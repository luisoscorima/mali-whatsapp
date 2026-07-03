import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { segmentToneClass } from './segmentColors'

type SegmentDefinition = {
  id: number
  slug: string
  label: string
  sort_order: number
  color_key: string
}

export function SegmentsListPage() {
  const [segments, setSegments] = useState<SegmentDefinition[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    apiClient.get<SegmentDefinition[]>('/api/segments').then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSegments(result.data)
    })
  }, [])

  if (error) {
    return <p className="text-bad">{error}</p>
  }

  if (!segments) {
    return <p className="text-muted">Cargando segmentos…</p>
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Segmentos</h1>
          <p className="text-sm text-muted">
            Etiquetas de audiencia para contactos y campañas.
          </p>
        </div>
        <Link
          to="/segments/new"
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white"
        >
          + Añadir segmento
        </Link>
      </div>

      {segments.length === 0 ? (
        <p className="text-sm text-muted">No hay segmentos definidos.</p>
      ) : (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface-strong">
          {segments.map((seg) => (
            <li key={seg.id}>
              <Link
                to={`/segments/${seg.id}`}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-accent-soft"
              >
                <div>
                  <p className="font-medium">{seg.label}</p>
                  <span
                    className={`mt-1 inline-block rounded px-2 py-0.5 font-mono text-xs ${segmentToneClass(seg.color_key)}`}
                  >
                    {seg.slug}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
