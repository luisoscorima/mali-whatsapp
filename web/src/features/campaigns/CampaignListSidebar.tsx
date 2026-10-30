import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/shared/api'
import { formatDateTime } from '@/shared/format'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { MonthFilterChips } from '@/shared/ui/MonthFilterChips'
import { campaignStatusClass } from './campaignStatus'
import {
  categoryLabel,
  categoryLine,
  mixesCategories,
  useCategoryScope,
  withCategoryQuery,
} from '@/shared/area/useCategoryScope'
import { SegmentFilterSelect } from '../segments/SegmentFilterSelect'

const LIST_POLL_MS = 15000

const SEND_MODE_FILTERS = [
  { key: '', label: 'Todas' },
  { key: 'direct', label: 'Directo' },
  { key: 'mass', label: 'Masivo' },
] as const

export type CampaignListItem = {
  id: number
  segment_display: string
  segments?: string[]
  template_name: string
  status: string
  total_recipients: number
  scheduled_at: string | null
  first_send_at: string | null
  sent_percent: number | null
  sent_ratio: string
  send_mode: string
  categories?: string[]
  line?: string
}

type SegmentOption = {
  id?: number
  slug: string
  label: string
  color_key: string
  category?: string | null
}

type CampaignListSidebarProps = {
  selectedId?: number | null
  onRefresh?: () => void
}

function normalizeSendMode(raw: string | null | undefined): 'direct' | 'mass' {
  return raw === 'direct' ? 'direct' : 'mass'
}

function campaignSegmentSlugs(campaign: CampaignListItem): string[] {
  if (Array.isArray(campaign.segments) && campaign.segments.length) {
    return campaign.segments
  }
  return String(campaign.segment_display || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

export function CampaignListSidebar({ selectedId, onRefresh }: CampaignListSidebarProps) {
  const scope = useCategoryScope()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [campaigns, setCampaigns] = useState<CampaignListItem[] | null>(null)
  const [segmentOptions, setSegmentOptions] = useState<SegmentOption[]>([])
  const listQuery = location.search
  const month = searchParams.get('month') ?? ''
  const sendMode = searchParams.get('mode') ?? ''
  const selectedSegments = searchParams.getAll('segment')

  const refresh = useCallback(() => {
    const qs = month ? `month=${encodeURIComponent(month)}` : ''
    const query = [qs, scope.query].filter(Boolean).join('&')
    void apiClient.get<CampaignListItem[]>(`/api/campaigns${query ? `?${query}` : ''}`).then((result) => {
      if (result.ok) setCampaigns(result.data)
    })
    onRefresh?.()
  }, [month, onRefresh, scope.query, scope.revision])

  useEffect(() => {
    refresh()
  }, [listQuery, refresh])

  useEffect(() => {
    let cancelled = false
    void apiClient
      .get<Array<{ id: number; slug: string; label: string; color_key: string; category?: string }>>(
        withCategoryQuery('/api/segments/active', scope.query),
      )
      .then((result) => {
        if (cancelled || !result.ok) return
        setSegmentOptions(
          result.data.map((seg) => ({
            id: seg.id,
            slug: seg.slug,
            label: seg.label,
            color_key: seg.color_key,
            category: seg.category ?? null,
          })),
        )
      })
    return () => {
      cancelled = true
    }
  }, [scope.query, scope.revision])

  useIntervalWhenVisible(refresh, LIST_POLL_MS)

  const filteredCampaigns = useMemo(() => {
    if (!campaigns) return null
    const mode = sendMode === 'direct' || sendMode === 'mass' ? sendMode : ''
    return campaigns.filter((campaign) => {
      if (mode && normalizeSendMode(campaign.send_mode) !== mode) return false
      if (!selectedSegments.length) return true
      const slugs = campaignSegmentSlugs(campaign)
      return selectedSegments.some((slug) => slugs.includes(slug))
    })
  }, [campaigns, sendMode, selectedSegments])

  function setSendModeFilter(key: string) {
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      if (key) next.set('mode', key)
      else next.delete('mode')
      return next
    })
  }

  function toggleSegment(slug: string) {
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      const current = next.getAll('segment')
      next.delete('segment')
      const selected = current.includes(slug)
        ? current.filter((item) => item !== slug)
        : [...current, slug]
      selected.forEach((item) => next.append('segment', item))
      return next
    })
  }

  return (
    <WaSidebar
      title={filteredCampaigns != null ? `Campañas (${filteredCampaigns.length})` : 'Campañas'}
      actions={
        <Link to="/campaigns/new" className="small-btn primary">
          +
        </Link>
      }
      filters={
        <div className="space-y-2">
          <div
            className="inbox-chat-filter-pills inbox-chat-filter-pills--row contact-filter-pills segment-filter-chips"
            aria-label="Filtrar por tipo de envío"
          >
            {SEND_MODE_FILTERS.map((opt) => (
              <button
                key={opt.key || 'all-mode'}
                type="button"
                className={`inbox-chat-pill contact-filter-pill text-[11px] ${
                  sendMode === opt.key ? 'is-active' : ''
                }`}
                onClick={() => setSendModeFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
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
          {segmentOptions.length > 0 ? (
            <SegmentFilterSelect
              compact
              showNoneOption={false}
              segments={segmentOptions.map((seg) => ({
                ...seg,
                group: scope.education ? categoryLabel(seg.category) : undefined,
              }))}
              selectedSlugs={selectedSegments}
              onToggle={toggleSegment}
              onClearAll={() =>
                setSearchParams((sp) => {
                  const next = new URLSearchParams(sp)
                  next.delete('segment')
                  return next
                })
              }
            />
          ) : null}
        </div>
      }
    >
      {!filteredCampaigns ? (
        <p className="inbox-empty-list">Cargando…</p>
      ) : filteredCampaigns.length === 0 ? (
        <p className="inbox-empty-list">No hay campañas en este filtro.</p>
      ) : (
        <ul className="inbox-chat-list">
          {filteredCampaigns.map((c) => {
            const sendWhen = c.first_send_at || c.scheduled_at
            const active = selectedId === c.id
            return (
              <li key={c.id} className={`inbox-chat-item ${active ? 'is-active' : ''}`}>
                <Link to={`/campaigns/${c.id}${listQuery}`} className="inbox-chat-link">
                  <span className="inbox-chat-link-main">
                    {mixesCategories(scope) ? (
                      <span className="inbox-chat-line">
                        <span>{categoryLine(c.categories?.length ? c.categories : ['general'])}</span>
                      </span>
                    ) : null}
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
                    {c.line ? <span className="inbox-chat-preview">{c.line}</span> : null}
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
