import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { notify } from '@/shared/notify'
import { TEMPLATE_FLASH_MESSAGES } from './templateFlash'
import { templateStatusClass } from './templateStatus'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'

const LIST_POLL_MS = 15000

const CATEGORY_FILTERS = [
  { key: '', label: 'Todas' },
  { key: 'MARKETING', label: 'Marketing' },
  { key: 'UTILITY', label: 'Utilidad' },
  { key: 'AUTHENTICATION', label: 'Auth' },
] as const

const STATUS_FILTERS = [
  { key: '', label: 'Todos' },
  { key: 'APPROVED', label: 'Aprobadas' },
  { key: 'PENDING', label: 'Pendientes' },
  { key: 'REJECTED', label: 'Rechazadas' },
  { key: 'DISABLED', label: 'Deshabilitadas' },
] as const

const VISIBILITY_FILTERS = [
  { key: '', label: 'Todas' },
  { key: 'active', label: 'Activas' },
  { key: 'inactive', label: 'Inactivas' },
] as const

type CategoryFilterKey = (typeof CATEGORY_FILTERS)[number]['key']
type StatusFilterKey = (typeof STATUS_FILTERS)[number]['key']
type VisibilityFilterKey = (typeof VISIBILITY_FILTERS)[number]['key']

type TemplateListItem = {
  id: number
  name: string
  language: string
  category: string | null
  status: string
  rejection_reason: string | null
  submitted_at: string | null
  synced_at: string
  active: boolean
}

type TemplatesListSidebarProps = {
  selectedId?: number | null
}

function isCategoryFilterKey(value: string): value is CategoryFilterKey {
  return CATEGORY_FILTERS.some((opt) => opt.key === value)
}

function isStatusFilterKey(value: string): value is StatusFilterKey {
  return STATUS_FILTERS.some((opt) => opt.key === value)
}

function isVisibilityFilterKey(value: string): value is VisibilityFilterKey {
  return VISIBILITY_FILTERS.some((opt) => opt.key === value)
}

export function TemplatesListSidebar({ selectedId }: TemplatesListSidebarProps) {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const [templates, setTemplates] = useState<TemplateListItem[] | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [syncing, setSyncing] = useState(false)

  const categoryRaw = searchParams.get('category') ?? ''
  const statusRaw = searchParams.get('status') ?? ''
  const visibilityRaw = searchParams.get('visibility') ?? ''
  const categoryFilter: CategoryFilterKey = isCategoryFilterKey(categoryRaw)
    ? categoryRaw
    : ''
  const statusFilter: StatusFilterKey = isStatusFilterKey(statusRaw) ? statusRaw : ''
  const visibilityFilter: VisibilityFilterKey = isVisibilityFilterKey(visibilityRaw)
    ? visibilityRaw
    : ''

  const listQuery = useMemo(() => {
    const qs = new URLSearchParams(location.search)
    return qs.toString() ? `?${qs.toString()}` : ''
  }, [location.search])

  async function load() {
    const result = await apiClient.get<TemplateListItem[]>('/api/templates')
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setTemplates(result.data)
  }

  useEffect(() => {
    void load()
  }, [location.search])

  useIntervalWhenVisible(() => void load(), LIST_POLL_MS)

  const filteredTemplates = useMemo(() => {
    if (!templates) return null
    const q = searchQuery.trim().toLowerCase()
    return templates.filter((t) => {
      if (categoryFilter && (t.category ?? '').toUpperCase() !== categoryFilter) {
        return false
      }
      if (statusFilter && t.status.toUpperCase() !== statusFilter) {
        return false
      }
      if (visibilityFilter === 'active' && !t.active) return false
      if (visibilityFilter === 'inactive' && t.active) return false
      if (!q) return true
      return (
        t.name.toLowerCase().includes(q) ||
        t.language.toLowerCase().includes(q) ||
        (t.category ?? '').toLowerCase().includes(q) ||
        t.status.toLowerCase().includes(q)
      )
    })
  }, [templates, searchQuery, categoryFilter, statusFilter, visibilityFilter])

  function setCategoryFilter(key: CategoryFilterKey) {
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      if (key) next.set('category', key)
      else next.delete('category')
      return next
    })
  }

  function setStatusFilter(key: StatusFilterKey) {
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      if (key) next.set('status', key)
      else next.delete('status')
      return next
    })
  }

  function setVisibilityFilter(key: VisibilityFilterKey) {
    setSearchParams((sp) => {
      const next = new URLSearchParams(sp)
      if (key) next.set('visibility', key)
      else next.delete('visibility')
      return next
    })
  }

  async function onSync() {
    setSyncing(true)
    const result = await apiClient.post<{ count: number }>('/api/templates/sync', {})
    setSyncing(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success(TEMPLATE_FLASH_MESSAGES.synced)
    await load()
  }

  return (
    <WaSidebar
      title={
        filteredTemplates != null
          ? `Plantillas (${filteredTemplates.length})`
          : 'Plantillas'
      }
      actions={
        <>
          <button
            type="button"
            onClick={() => void onSync()}
            disabled={syncing}
            className="small-btn"
            title="Sincronizar desde Meta"
          >
            {syncing ? '…' : 'Sync'}
          </button>
          <Link to={`/templates/new${listQuery}`} className="small-btn primary">
            +
          </Link>
        </>
      }
      filters={
        <div className="space-y-2">
          <div className="inbox-search-row">
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar plantilla…"
              className="inbox-search-input"
              aria-label="Buscar plantillas"
            />
          </div>
          <div
            className="inbox-chat-filter-pills inbox-chat-filter-pills--row contact-filter-pills segment-filter-chips"
            aria-label="Filtrar por categoría"
          >
            {CATEGORY_FILTERS.map((opt) => (
              <button
                key={opt.key || 'all-category'}
                type="button"
                className={`inbox-chat-pill contact-filter-pill text-[11px] ${
                  categoryFilter === opt.key ? 'is-active' : ''
                }`}
                onClick={() => setCategoryFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div
            className="inbox-chat-filter-pills inbox-chat-filter-pills--row contact-filter-pills segment-filter-chips"
            aria-label="Filtrar por estado Meta"
          >
            {STATUS_FILTERS.map((opt) => (
              <button
                key={opt.key || 'all-status'}
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
          <div
            className="inbox-chat-filter-pills inbox-chat-filter-pills--row contact-filter-pills segment-filter-chips"
            aria-label="Filtrar por visibilidad"
          >
            {VISIBILITY_FILTERS.map((opt) => (
              <button
                key={opt.key || 'all-visibility'}
                type="button"
                className={`inbox-chat-pill contact-filter-pill text-[11px] ${
                  visibilityFilter === opt.key ? 'is-active' : ''
                }`}
                onClick={() => setVisibilityFilter(opt.key)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      }
    >
      {!filteredTemplates ? (
        <p className="inbox-empty-list">Cargando plantillas…</p>
      ) : filteredTemplates.length === 0 ? (
        <p className="inbox-empty-list">
          {templates?.length
            ? 'No hay plantillas en este filtro.'
            : 'No hay plantillas en caché. Pulsa Sync para traerlas desde Meta.'}
        </p>
      ) : (
        <ul className="inbox-chat-list">
          {filteredTemplates.map((t) => {
            const isSelected = selectedId === t.id
            return (
              <li
                key={t.id}
                className={`inbox-chat-item ${isSelected ? 'is-active' : ''}`}
              >
                <Link to={`/templates/${t.id}${listQuery}`} className="inbox-chat-link">
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-row-top">
                      <span className="inbox-chat-title-line">
                        <span className="inbox-chat-title font-mono">{t.name}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                        <span
                          className={`rounded px-1.5 text-[10px] ${
                            t.active
                              ? 'bg-accent-soft text-accent'
                              : 'bg-bad/15 text-bad'
                          }`}
                        >
                          {t.active ? 'Activo' : 'Inactivo'}
                        </span>
                        <span
                          className={`rounded px-1.5 text-[10px] ${templateStatusClass(t.status)}`}
                        >
                          {t.status}
                        </span>
                      </span>
                    </span>
                    <span className="inbox-chat-preview">
                      {t.language} · {t.category || '—'}
                      {t.submitted_at
                        ? ` · ${formatDateTime(t.submitted_at).split(',')[0]}`
                        : ''}
                    </span>
                    {t.rejection_reason ? (
                      <span className="inbox-chat-preview text-bad line-clamp-1">
                        {t.rejection_reason}
                      </span>
                    ) : null}
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
