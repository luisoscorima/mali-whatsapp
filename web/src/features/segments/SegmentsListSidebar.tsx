import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { MonthFilterChips } from '@/shared/ui/MonthFilterChips'
import { SortableSidebarList } from '@/shared/ui/SortableSidebarList'
import { SegmentBadge } from './SegmentBadge'

const LIST_POLL_MS = 15000

type SegmentDefinition = {
  id: number
  slug: string
  label: string
  sort_order: number
  color_key: string
  active: boolean
  show_in_filter: boolean
  assignable: boolean
  created_at: string
}

type SegmentsListSidebarProps = {
  selectedId?: number | null
}

export function SegmentsListSidebar({ selectedId }: SegmentsListSidebarProps) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [segments, setSegments] = useState<SegmentDefinition[] | null>(null)
  const month = searchParams.get('month') ?? ''

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

  async function handleReorder(orderedIds: number[]) {
    const res = await apiClient.patch('/api/segments/reorder', { orderedIds })
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    refresh()
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
      }
    >
      {!segments ? (
        <p className="inbox-empty-list">Cargando segmentos…</p>
      ) : segments.length === 0 ? (
        <p className="inbox-empty-list">No hay segmentos en este filtro.</p>
      ) : (
        <SortableSidebarList
          items={segments}
          onReorder={handleReorder}
          renderItem={(seg, dragHandle) => {
            const active = selectedId === seg.id
            return (
              <div
                className={`inbox-chat-item flex items-stretch ${active ? 'is-active' : ''}`}
              >
                {dragHandle}
                <Link to={`/segments/${seg.id}${listQuery}`} className="inbox-chat-link flex-1">
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-row-top">
                      <span className="inbox-chat-title">
                        {seg.label}
                        {!seg.active ? (
                          <span className="ml-1 text-[10px] text-muted">(inactivo)</span>
                        ) : null}
                      </span>
                    </span>
                    <SegmentBadge
                      colorKey={seg.color_key}
                      className="inbox-chat-segment font-mono text-[10px]"
                    >
                      {seg.slug}
                    </SegmentBadge>
                  </span>
                </Link>
              </div>
            )
          }}
        />
      )}
    </WaSidebar>
  )
}
