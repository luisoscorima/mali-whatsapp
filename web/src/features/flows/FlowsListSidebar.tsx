import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'

const LIST_POLL_MS = 20000

export type FlowListItem = {
  id: number
  name: string
  status: 'draft' | 'active' | 'paused'
  trigger_payload: string
  node_count: number
  active_sessions: number
  completed_sessions: number
  handed_off_sessions: number
  updated_at: string
}

type FlowsListSidebarProps = {
  selectedId?: number | null
}

const STATUS_LABEL: Record<FlowListItem['status'], string> = {
  draft: 'Borrador',
  active: 'Activo',
  paused: 'Pausado',
}

export function FlowsListSidebar({ selectedId }: FlowsListSidebarProps) {
  const location = useLocation()
  const [items, setItems] = useState<FlowListItem[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const result = await apiClient.get<FlowListItem[]>('/api/flows')
    if (!result.ok) {
      notify.error(result.error)
      setLoading(false)
      return
    }
    setItems(result.data)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load, location.pathname])

  useIntervalWhenVisible(load, LIST_POLL_MS)

  return (
    <WaSidebar
      title={
        loading && items.length === 0
          ? 'Respuestas automatizadas'
          : `Respuestas automatizadas (${items.length})`
      }
      actions={
        <Link to="/flows/new" className="small-btn primary">
          +
        </Link>
      }
    >
      {loading && items.length === 0 ? (
        <p className="inbox-empty-list">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="inbox-empty-list">Aún no hay flujos. Crea el primero.</p>
      ) : (
        <ul className="inbox-chat-list">
          {items.map((item) => {
            const active = selectedId === item.id
            return (
              <li
                key={item.id}
                className={`inbox-chat-item ${active ? 'is-active' : ''}`}
              >
                <Link to={`/flows/${item.id}`} className="inbox-chat-link">
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-row-top">
                      <span className="inbox-chat-title-line">
                        <span className="inbox-chat-title">{item.name}</span>
                      </span>
                      <span className="inbox-chat-meta shrink-0 text-[10px]">
                        {STATUS_LABEL[item.status]}
                      </span>
                    </span>
                    <span className="inbox-chat-preview font-mono text-xs">
                      {item.trigger_payload}
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
