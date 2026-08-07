import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { SortableSidebarList } from '@/shared/ui/SortableSidebarList'
import { SegmentBadge } from './SegmentBadge'
import {
  SEGMENTS_LIST_REFRESH_EVENT,
  SEGMENTS_LIST_UPSERT_EVENT,
} from './segmentsListEvents'

const LIST_POLL_MS = 15000

const STATUS_FILTERS = [
  { key: '', label: 'Todos' },
  { key: 'active', label: 'Activos' },
  { key: 'inactive', label: 'Inactivos' },
  { key: 'in_filter', label: 'En filtros' },
  { key: 'assignable', label: 'Asignables' },
] as const

type StatusFilterKey = (typeof STATUS_FILTERS)[number]['key']

type SegmentDefinition = {
  id: number
  slug: string
  label: string
  sort_order: number
  color_key: string
  active: boolean
  show_in_filter: boolean
  assignable: boolean
  assignment_group: string | null
  created_at: string
}

type SegmentsListSidebarProps = {
  selectedId?: number | null
}

function matchesStatusFilter(seg: SegmentDefinition, filter: StatusFilterKey): boolean {
  if (filter === 'active') return seg.active
  if (filter === 'inactive') return !seg.active
  if (filter === 'in_filter') return seg.show_in_filter
  if (filter === 'assignable') return seg.assignable
  return true
}

function isStatusFilterKey(value: string): value is StatusFilterKey {
  return STATUS_FILTERS.some((opt) => opt.key === value)
}

function FilterVisibilityIcon({ visible }: { visible: boolean }) {
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

  if (visible) {
    return (
      <svg {...common}>
        <title>Visible en filtros</title>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    )
  }

  return (
    <svg {...common}>
      <title>Oculto en filtros</title>
      <path d="M10.7 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-2.2 3.1" />
      <path d="M6.6 6.6C3.9 8.5 2 12 2 12s3.5 7 10 7a9.7 9.7 0 0 0 4.4-1" />
      <path d="M14.1 14.1a3 3 0 1 1-4.2-4.2" />
      <path d="m3 3 18 18" />
    </svg>
  )
}

export function SegmentsListSidebar({ selectedId }: SegmentsListSidebarProps) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [segments, setSegments] = useState<SegmentDefinition[] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const statusRaw = searchParams.get('status') ?? ''
  const statusFilter: StatusFilterKey = isStatusFilterKey(statusRaw) ? statusRaw : ''

  const listQuery = useMemo(() => {
    const qs = new URLSearchParams(location.search)
    qs.delete('month')
    return qs.toString() ? `?${qs.toString()}` : ''
  }, [location.search])

  const refresh = useCallback(() => {
    void apiClient.get<SegmentDefinition[]>('/api/segments').then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        return
      }
      setSegments(result.data)
    })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const onRefresh = () => refresh()
    const onUpsert = (event: Event) => {
      const segment = (event as CustomEvent<SegmentDefinition>).detail
      if (!segment?.id) return
      setSegments((prev) => {
        if (!prev) return [segment]
        const idx = prev.findIndex((s) => s.id === segment.id)
        if (idx < 0) return [...prev, segment]
        const next = prev.slice()
        next[idx] = { ...next[idx], ...segment }
        return next
      })
    }
    window.addEventListener(SEGMENTS_LIST_REFRESH_EVENT, onRefresh)
    window.addEventListener(SEGMENTS_LIST_UPSERT_EVENT, onUpsert)
    return () => {
      window.removeEventListener(SEGMENTS_LIST_REFRESH_EVENT, onRefresh)
      window.removeEventListener(SEGMENTS_LIST_UPSERT_EVENT, onUpsert)
    }
  }, [refresh])

  useIntervalWhenVisible(refresh, LIST_POLL_MS)

  const filteredSegments = useMemo(() => {
    if (!segments) return null
    const q = searchQuery.trim().toLowerCase()
    return segments.filter((seg) => {
      if (!matchesStatusFilter(seg, statusFilter)) return false
      if (!q) return true
      return (
        seg.label.toLowerCase().includes(q) || seg.slug.toLowerCase().includes(q)
      )
    })
  }, [segments, statusFilter, searchQuery])

  const canReorder = !statusFilter && !searchQuery.trim()

  async function handleReorder(orderedIds: number[]) {
    if (!canReorder) return
    const res = await apiClient.patch('/api/segments/reorder', { orderedIds })
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    refresh()
  }

  function setStatusFilter(key: StatusFilterKey) {
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      next.delete('month')
      if (key) next.set('status', key)
      else next.delete('status')
      return next
    })
  }

  return (
    <WaSidebar
      title={
        filteredSegments != null
          ? `Segmentos (${filteredSegments.length})`
          : 'Segmentos'
      }
      actions={
        <Link to={`/segments/new${listQuery}`} className="small-btn primary">
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
              aria-label="Buscar segmentos"
            />
          </div>
          <div
            className="inbox-chat-filter-pills inbox-chat-filter-pills--row contact-filter-pills segment-filter-chips"
            aria-label="Filtrar segmentos"
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
      {!filteredSegments ? (
        <p className="inbox-empty-list">Cargando segmentos…</p>
      ) : filteredSegments.length === 0 ? (
        <p className="inbox-empty-list">No hay segmentos en este filtro.</p>
      ) : canReorder ? (
        <SortableSidebarList
          items={filteredSegments}
          onReorder={handleReorder}
          renderItem={(seg, dragHandle) =>
            renderSegmentRow(seg, selectedId, listQuery, dragHandle)
          }
        />
      ) : (
        <ul className="inbox-chat-list">
          {filteredSegments.map((seg) => (
            <li key={seg.id}>{renderSegmentRow(seg, selectedId, listQuery)}</li>
          ))}
        </ul>
      )}
    </WaSidebar>
  )
}

function renderSegmentRow(
  seg: SegmentDefinition,
  selectedId: number | null | undefined,
  listQuery: string,
  dragHandle?: ReactNode,
) {
  const active = selectedId === seg.id
  return (
    <div className={`inbox-chat-item flex items-stretch ${active ? 'is-active' : ''}`}>
      {dragHandle}
      <Link to={`/segments/${seg.id}${listQuery}`} className="inbox-chat-link flex-1">
        <span className="inbox-chat-link-main">
          <span className="inbox-chat-row-top">
            <span className="inbox-chat-title-line">
              <span className="inbox-chat-title">{seg.label}</span>
            </span>
            <span
              className={`shrink-0 rounded px-1.5 text-[10px] ${
                seg.active ? 'bg-accent-soft text-accent' : 'bg-bad/15 text-bad'
              }`}
            >
              {seg.active ? 'Activo' : 'Inactivo'}
            </span>
          </span>
          <span className="inbox-chat-row-top">
            <SegmentBadge
              colorKey={seg.color_key}
              className="inbox-chat-segment font-mono text-[10px]"
            >
              {seg.slug}
            </SegmentBadge>
            <span className="ml-auto shrink-0">
              <FilterVisibilityIcon visible={seg.show_in_filter} />
            </span>
          </span>
          {seg.assignable ? (
            <span className="mt-0.5 block text-[10px] leading-snug text-muted">
              Asignable{seg.assignment_group ? `: ${seg.assignment_group}` : ''}
            </span>
          ) : null}
        </span>
      </Link>
    </div>
  )
}
