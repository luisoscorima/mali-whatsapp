import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { formatDateTime } from '@/shared/format'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { MonthFilterChips } from '@/shared/ui/MonthFilterChips'
import { campaignStatusClass } from './campaignStatus'

const LIST_POLL_MS = 15000

export type CampaignListItem = {
  id: number
  segment_display: string
  template_name: string
  status: string
  total_recipients: number
  scheduled_at: string | null
  first_send_at: string | null
  sent_percent: number | null
  sent_ratio: string
  send_mode: string
}

type CampaignListSidebarProps = {
  selectedId?: number | null
  onRefresh?: () => void
}

export function CampaignListSidebar({ selectedId, onRefresh }: CampaignListSidebarProps) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null)
  const listQuery = location.search
  const month = searchParams.get('month') ?? ''

  const refresh = useCallback(() => {
    const qs = month ? `?month=${encodeURIComponent(month)}` : ''
    void apiClient.get<CampaignListItem[]>(`/api/campaigns${qs}`).then((result) => {
      if (result.ok) setCampaigns(result.data)
    })
    onRefresh?.()
  }, [month, onRefresh])

  useEffect(() => {
    refresh()
  }, [listQuery, refresh])

  useIntervalWhenVisible(refresh, LIST_POLL_MS)

  return (
    <WaSidebar
      title="Campañas"
      actions={
        <Link to="/campaigns/new" className="small-btn primary">
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
      {!campaigns ? (
        <p className="inbox-empty-list">Cargando…</p>
      ) : campaigns.length === 0 ? (
        <p className="inbox-empty-list">No hay campañas en este filtro.</p>
      ) : (
        <ul className="inbox-chat-list">
          {campaigns.map((c) => {
            const sendWhen = c.first_send_at || c.scheduled_at
            const active = selectedId === c.id
            return (
              <li key={c.id} className={`inbox-chat-item ${active ? 'is-active' : ''}`}>
                <Link to={`/campaigns/${c.id}${listQuery}`} className="inbox-chat-link">
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-row-top">
                      <span className="inbox-chat-title-line">
                        <span className="inbox-chat-title">
                          #{c.id} · {c.template_name || '—'}
                        </span>
                      </span>
                      <span className="flex shrink-0 gap-1">
                        {c.send_mode === 'direct' ? (
                          <span className="rounded bg-amber-500/15 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">
                            Directo
                          </span>
                        ) : null}
                        <span
                          className={`rounded px-1.5 text-[10px] ${campaignStatusClass(c.status)}`}
                        >
                          {c.status}
                        </span>
                      </span>
                    </span>
                    <span className="inbox-chat-preview">{c.segment_display || '—'}</span>
                    <span className="inbox-chat-preview">
                      {c.sent_ratio}
                      {sendWhen ? ` · ${formatDateTime(sendWhen).split(',')[0]}` : ''}
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
