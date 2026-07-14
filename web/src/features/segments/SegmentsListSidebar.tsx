import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { MonthFilterChips } from '@/shared/ui/MonthFilterChips'
import { SortableSidebarList } from '@/shared/ui/SortableSidebarList'
import { SegmentBadge } from './SegmentBadge'

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

export function SegmentsListSidebar({ selectedId }: SegmentsListSidebarProps) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [segments, setSegments] = useState<SegmentDefinition[] | null>(null)
  const month = searchParams.get('month') ?? ''
  const statusRaw = searchParams.get('status') ?? ''
  const statusFilter: StatusFilterKey = isStatusFilterKey(statusRaw) ? statusRaw : ''

  const listQuery = useMemo(() => {
    const qs = new URLSearchParams(location.search)
    return qs.toString() ? `?${qs.toString()}` : ''
  }, [location.search])

  const refresh = useCallback(() => {
    const qs = month ? `?month=${encodeURIComponent(month)}` : ''
    void apiClient.get<SegmentDefinition[]>(`/api/segments${qs}`).then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        return
      }
      setSegments(result.data)
    })
  }, [month])

  useEffect(() => {
    refresh()
  }, [refresh])

  useIntervalWhenVisible(refresh, LIST_POLL_MS)

  const filteredSegments = useMemo(() => {
    if (!segments) return null
    return segments.filter((seg) => matchesStatusFilter(seg, statusFilter))
  }, [segments, statusFilter])

  const canReorder = !statusFilter

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
      if (key) next.set('status', key)
      else next.delete('status')
      return next
    })
  }

  return (
    <WaSidebar
      title="Segmentos"
      actions={
        <Link to={`/segments/new${listQuery}`} className="small-btn primary">
          +
        </Link>
      }
      filters={
        <div className="space-y-2">
          <MonthFilterChips
            selectedMonthKey={month}
            onChange={(key) =>
              setSearchParams((sp) => {
                const next = new URLSearchParams(sp)
                if (key) next.set('month', key)
                else next.delete('month')
                return next
              })
            }
          />
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
            <span className="inbox-chat-title">{seg.label}</span>
          </span>
          <SegmentBadge
            colorKey={seg.color_key}
            className="inbox-chat-segment font-mono text-[10px]"
          >
            {seg.slug}
          </SegmentBadge>
          <span className="mt-0.5 block text-[10px] leading-snug text-muted">
            {seg.active ? 'Activo' : 'Inactivo'}
            {' · '}
            {seg.show_in_filter ? 'En filtros' : 'Sin filtros'}
            {seg.assignable
              ? ` · Asignable${seg.assignment_group ? `: ${seg.assignment_group}` : ''}`
              : null}
          </span>
        </span>
      </Link>
    </div>
  )
}
