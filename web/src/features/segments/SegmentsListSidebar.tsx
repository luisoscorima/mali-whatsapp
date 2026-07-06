import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { segmentToneClass } from './segmentColors'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'

type SegmentDefinition = {
  id: number
  slug: string
  label: string
  sort_order: number
  color_key: string
}

type SegmentsListSidebarProps = {
  selectedId?: number | null
}

export function SegmentsListSidebar({ selectedId }: SegmentsListSidebarProps) {
  const location = useLocation()
  const [segments, setSegments] = useState<SegmentDefinition[] | null>(null)
  const [error, setError] = useState('')

  function refresh() {
    void apiClient.get<SegmentDefinition[]>('/api/segments').then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSegments(result.data)
      setError('')
    })
  }

  useEffect(() => {
    refresh()
  }, [location.search])

  return (
    <WaSidebar
      title="Segmentos"
      onRefresh={refresh}
      refreshTitle="Actualizar lista"
      actions={
        <Link to="/segments/new" className="small-btn primary">
          +
        </Link>
      }
      filters={error ? <p className="px-3 text-xs text-bad">{error}</p> : null}
    >
      {!segments ? (
        <p className="inbox-empty-list">Cargando segmentos…</p>
      ) : segments.length === 0 ? (
        <p className="inbox-empty-list">No hay segmentos definidos.</p>
      ) : (
        <ul className="inbox-chat-list">
          {segments.map((seg) => {
            const active = selectedId === seg.id
            return (
              <li key={seg.id} className={`inbox-chat-item ${active ? 'is-active' : ''}`}>
                <Link to={`/segments/${seg.id}`} className="inbox-chat-link">
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-row-top">
                      <span className="inbox-chat-title">{seg.label}</span>
                    </span>
                    <span
                      className={`inline-block rounded px-1.5 py-0.5 font-mono text-[10px] ${segmentToneClass(seg.color_key)}`}
                    >
                      {seg.slug}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WaSidebar>
  )
}
