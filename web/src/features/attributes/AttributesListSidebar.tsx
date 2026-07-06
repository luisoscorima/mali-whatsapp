import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'

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
  return seg?.label ?? def.segment_slug
}

type AttributesListSidebarProps = {
  selectedId?: number | null
}

export function AttributesListSidebar({ selectedId }: AttributesListSidebarProps) {
  const location = useLocation()
  const [definitions, setDefinitions] = useState<AttributeDefinition[] | null>(null)
  const [segments, setSegments] = useState<SegmentOption[]>([])
  const [error, setError] = useState('')

  function refresh() {
    void Promise.all([
      apiClient.get<AttributeDefinition[]>('/api/attribute-definitions'),
      apiClient.get<SegmentOption[]>('/api/attribute-definitions/segments'),
    ]).then(([defs, segs]) => {
      if (!defs.ok) {
        setError(defs.error)
        return
      }
      setDefinitions(defs.data)
      if (segs.ok) setSegments(segs.data)
      setError('')
    })
  }

  useEffect(() => {
    refresh()
  }, [location.search])

  return (
    <WaSidebar
      title="Atributos"
      onRefresh={refresh}
      refreshTitle="Actualizar lista"
      actions={
        <Link to="/attributes/new" className="small-btn primary">
          +
        </Link>
      }
      filters={error ? <p className="px-3 text-xs text-bad">{error}</p> : null}
    >
      {!definitions ? (
        <p className="inbox-empty-list">Cargando atributos…</p>
      ) : definitions.length === 0 ? (
        <p className="inbox-empty-list">Sin definiciones. Crea atributos del área o por segmento.</p>
      ) : (
        <ul className="inbox-chat-list">
          {definitions.map((def) => {
            const active = selectedId === def.id
            return (
              <li key={def.id} className={`inbox-chat-item ${active ? 'is-active' : ''}`}>
                <Link to={`/attributes/${def.id}`} className="inbox-chat-link">
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-row-top">
                      <span className="inbox-chat-title">
                        {def.label}
                        {!def.active ? (
                          <span className="ml-1 text-[10px] text-muted">(inactivo)</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="inbox-chat-preview font-mono">{def.slug}</span>
                    <span className="inbox-chat-preview">
                      {scopeLabel(def, segments)} · {def.field_type}
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
