import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { SortableSidebarList } from '@/shared/ui/SortableSidebarList'

const LIST_POLL_MS = 15000

const STATUS_FILTERS = [
  { key: '', label: 'Todos' },
  { key: 'active', label: 'Activos' },
  { key: 'inactive', label: 'Inactivos' },
  { key: 'required', label: 'Obligatorio' },
  { key: 'text', label: 'Texto' },
  { key: 'number', label: 'Número' },
  { key: 'date', label: 'Fecha' },
  { key: 'select', label: 'Lista' },
] as const

type StatusFilterKey = (typeof STATUS_FILTERS)[number]['key']

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

type AttributesListSidebarProps = {
  selectedId?: number | null
}

function scopeLabel(def: AttributeDefinition, segments: SegmentOption[]): string {
  if (!def.segment_slug) return 'Área'
  const seg = segments.find((s) => s.slug === def.segment_slug)
  return seg?.label ?? def.segment_slug
}

function matchesStatusFilter(def: AttributeDefinition, filter: StatusFilterKey): boolean {
  if (filter === 'active') return def.active
  if (filter === 'inactive') return !def.active
  if (filter === 'required') return def.required
  if (filter === 'text' || filter === 'number' || filter === 'date' || filter === 'select') {
    return def.field_type === filter
  }
  return true
}

function isStatusFilterKey(value: string): value is StatusFilterKey {
  return STATUS_FILTERS.some((opt) => opt.key === value)
}

function FieldTypeIcon({ fieldType }: { fieldType: string }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'shrink-0 text-muted',
    'aria-hidden': true as const,
  }

  if (fieldType === 'number') {
    return (
      <svg {...common}>
        <title>Número</title>
        <line x1="4" x2="20" y1="9" y2="9" />
        <line x1="4" x2="20" y1="15" y2="15" />
        <line x1="10" x2="8" y1="3" y2="21" />
        <line x1="16" x2="14" y1="3" y2="21" />
      </svg>
    )
  }
  if (fieldType === 'date') {
    return (
      <svg {...common}>
        <title>Fecha</title>
        <path d="M8 2v4" />
        <path d="M16 2v4" />
        <rect width="18" height="18" x="3" y="4" rx="2" />
        <path d="M3 10h18" />
      </svg>
    )
  }
  if (fieldType === 'select') {
    return (
      <svg {...common}>
        <title>Lista</title>
        <path d="M8 6h13" />
        <path d="M8 12h13" />
        <path d="M8 18h13" />
        <path d="M3 6h.01" />
        <path d="M3 12h.01" />
        <path d="M3 18h.01" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <title>Texto</title>
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" x2="15" y1="20" y2="20" />
      <line x1="12" x2="12" y1="4" y2="20" />
    </svg>
  )
}

export function AttributesListSidebar({ selectedId }: AttributesListSidebarProps) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [definitions, setDefinitions] = useState<AttributeDefinition[] | null>(null)
  const [segments, setSegments] = useState<SegmentOption[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const statusRaw = searchParams.get('status') ?? ''
  const statusFilter: StatusFilterKey = isStatusFilterKey(statusRaw) ? statusRaw : ''

  const listQuery = useMemo(() => {
    const qs = new URLSearchParams(location.search)
    return qs.toString() ? `?${qs.toString()}` : ''
  }, [location.search])

  const refresh = useCallback(() => {
    void Promise.all([
      apiClient.get<AttributeDefinition[]>('/api/attribute-definitions'),
      apiClient.get<SegmentOption[]>('/api/attribute-definitions/segments'),
    ]).then(([defs, segs]) => {
      if (!defs.ok) {
        notify.error(defs.error)
        return
      }
      setDefinitions(defs.data)
      if (segs.ok) setSegments(segs.data)
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useIntervalWhenVisible(refresh, LIST_POLL_MS)

  const filteredDefinitions = useMemo(() => {
    if (!definitions) return null
    const q = searchQuery.trim().toLowerCase()
    return definitions.filter((def) => {
      if (!matchesStatusFilter(def, statusFilter)) return false
      if (!q) return true
      return (
        def.label.toLowerCase().includes(q) || def.slug.toLowerCase().includes(q)
      )
    })
  }, [definitions, statusFilter, searchQuery])

  const canReorder = !statusFilter && !searchQuery.trim()

  async function handleReorder(orderedIds: number[]) {
    if (!canReorder) return
    const res = await apiClient.patch('/api/attribute-definitions/reorder', {
      orderedIds,
    })
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    refresh()
  }

  function setStatusFilter(key: StatusFilterKey) {
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      if (key) next.set('status', key)
      else next.delete('status')
      return next
    })
  }

  return (
    <WaSidebar
      title="Atributos"
      actions={
        <Link to={`/attributes/new${listQuery}`} className="small-btn primary">
          +
        </Link>
      }
      filters={
        <div className="space-y-2">
          <div className="inbox-search-row">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por slug o etiqueta…"
              className="inbox-search-input"
              aria-label="Buscar atributos"
            />
          </div>
          <div
            className="inbox-chat-filter-pills inbox-chat-filter-pills--row contact-filter-pills segment-filter-chips"
            aria-label="Filtrar atributos"
          >
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.key || 'all'}
                type="button"
                className={`inbox-chat-pill contact-filter-pill text-[11px] ${
                  statusFilter === opt.key ? 'is-active' : ''
                }`}
                onClick={() => setStatusFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {!filteredDefinitions ? (
        <p className="inbox-empty-list">Cargando atributos…</p>
      ) : filteredDefinitions.length === 0 ? (
        <p className="inbox-empty-list">No hay atributos en este filtro.</p>
      ) : canReorder ? (
        <SortableSidebarList
          items={filteredDefinitions}
          onReorder={handleReorder}
          renderItem={(def, dragHandle) =>
            renderAttributeRow(def, selectedId, segments, listQuery, dragHandle)
          }
        />
      ) : (
        <ul className="inbox-chat-list">
          {filteredDefinitions.map((def) => (
            <li key={def.id}>{renderAttributeRow(def, selectedId, segments, listQuery)}</li>
          ))}
        </ul>
      )}
    </WaSidebar>
  )
}

function renderAttributeRow(
  def: AttributeDefinition,
  selectedId: number | null | undefined,
  segments: SegmentOption[],
  listQuery: string,
  dragHandle?: ReactNode,
) {
  const active = selectedId === def.id
  return (
    <div className={`inbox-chat-item flex items-stretch ${active ? 'is-active' : ''}`}>
      {dragHandle}
      <Link to={`/attributes/${def.id}${listQuery}`} className="inbox-chat-link flex-1">
        <span className="inbox-chat-link-main">
          <span className="inbox-chat-row-top">
            <span className="inbox-chat-title-line">
              <FieldTypeIcon fieldType={def.field_type} />
              <span className="inbox-chat-title">
                {def.label}
                {def.required ? <span className="text-bad">*</span> : null}
              </span>
            </span>
            <span
              className={`shrink-0 rounded px-1.5 text-[10px] ${
                def.active ? 'bg-accent-soft text-accent' : 'bg-bad/15 text-bad'
              }`}
            >
              {def.active ? 'Activo' : 'Inactivo'}
            </span>
          </span>
          <span className="inbox-chat-preview font-mono">{def.slug}</span>
          <span className="inbox-chat-preview">{scopeLabel(def, segments)}</span>
        </span>
      </Link>
    </div>
  )
}
