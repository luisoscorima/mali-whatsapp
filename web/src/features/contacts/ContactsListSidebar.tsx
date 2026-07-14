import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { formatContactName } from './contactName'
import { SegmentBadge } from '../segments/SegmentBadge'
import { SegmentFilterSelect } from '../segments/SegmentFilterSelect'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'

const LIST_POLL_MS = 15000

type SegmentOption = {
  id: number
  slug: string
  label: string
  color_key: string
}

type AttributeFilterOption = {
  slug: string
  label: string
  segment_slug: string | null
}

type ContactListItem = {
  id: number
  name: string
  last_name: string
  phone: string
  active: boolean
  replaced_by_contact_id: number | null
  replacement_reason: string | null
  segment_slugs: string[]
}

type ContactsListResult = {
  items: ContactListItem[]
  total: number
  page: number
  limit: number
  pages: number
}

type FilterOptions = {
  segments: SegmentOption[]
  attribute_filters: AttributeFilterOption[]
}

function segmentLabel(slug: string, segments: SegmentOption[]): string {
  return segments.find((s) => s.slug === slug)?.label ?? slug
}

function segmentColorKey(slug: string, segments: SegmentOption[]): string {
  return segments.find((s) => s.slug === slug)?.color_key ?? 'slate'
}

type ContactsListSidebarProps = {
  selectedId?: number | null
}

export function ContactsListSidebar({ selectedId }: ContactsListSidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [options, setOptions] = useState<FilterOptions | null>(null)
  const [result, setResult] = useState<ContactsListResult | null>(null)
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkSegment, setBulkSegment] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)

  const selectedSegments = searchParams.getAll('segment')
  const showReplaced = searchParams.get('show_replaced') === '1'
  const attrKey = searchParams.get('attr_key') ?? ''
  const attrValue = searchParams.get('attr_value') ?? ''
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)

  const apiQuery = useMemo(() => {
    const sp = new URLSearchParams()
    sp.set('page', String(page))
    sp.set('limit', '50')
    const q = searchParams.get('q')?.trim()
    if (q) sp.set('q', q)
    for (const seg of selectedSegments) {
      sp.append('segment', seg)
    }
    if (showReplaced) sp.set('show_replaced', '1')
    if (attrKey) sp.set('attr_key', attrKey)
    if (attrValue) sp.set('attr_value', attrValue)
    return sp.toString()
  }, [searchParams, page, selectedSegments, showReplaced, attrKey, attrValue])

  const exportQuery = useMemo(() => {
    const sp = new URLSearchParams()
    const q = searchParams.get('q')?.trim()
    if (q) sp.set('q', q)
    for (const seg of selectedSegments) {
      sp.append('segment', seg)
    }
    if (showReplaced) sp.set('show_replaced', '1')
    if (attrKey) sp.set('attr_key', attrKey)
    if (attrValue) sp.set('attr_value', attrValue)
    const value = sp.toString()
    return value ? `?${value}` : ''
  }, [searchParams, selectedSegments, showReplaced, attrKey, attrValue])

  useEffect(() => {
    apiClient.get<FilterOptions>('/api/contacts/filter-options').then((res) => {
      if (res.ok) setOptions(res.data)
    })
  }, [])

  function refresh() {
    void apiClient.get<ContactsListResult>(`/api/contacts?${apiQuery}`).then((res) => {
      if (!res.ok) notify.error(res.error)
      else setResult(res.data)
    })
  }

  useEffect(() => {
    refresh()
  }, [apiQuery])

  useIntervalWhenVisible(refresh, LIST_POLL_MS)

  function updateParams(mutator: (sp: URLSearchParams) => void) {
    const sp = new URLSearchParams(searchParams)
    mutator(sp)
    sp.delete('page')
    setSearchParams(sp)
  }

  function toggleSegment(slug: string) {
    updateParams((sp) => {
      const current = sp.getAll('segment')
      sp.delete('segment')
      if (current.includes(slug)) {
        current.filter((s) => s !== slug).forEach((s) => sp.append('segment', s))
      } else {
        [...current, slug].forEach((s) => sp.append('segment', s))
      }
    })
  }

  function onSearchSubmit(e: FormEvent) {
    e.preventDefault()
    updateParams((sp) => {
      const q = searchInput.trim()
      if (q) sp.set('q', q)
      else sp.delete('q')
    })
  }

  function goToPage(nextPage: number) {
    const sp = new URLSearchParams(searchParams)
    if (nextPage <= 1) sp.delete('page')
    else sp.set('page', String(nextPage))
    setSearchParams(sp)
  }

  function toggleContactSelection(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAllContacts() {
    if (!result) return
    setSelectedIds(new Set(result.items.map((c) => c.id)))
  }

  function clearContactSelection() {
    setSelectedIds(new Set())
  }

  async function handleBulkSegment(e: FormEvent) {
    e.preventDefault()
    if (!bulkSegment || selectedIds.size === 0) return
    setBulkBusy(true)
    const res = await apiClient.post<{ updated: number }>(
      '/api/contacts/bulk-add-segment',
      {
        segment_slug: bulkSegment,
        contact_ids: [...selectedIds],
      },
    )
    setBulkBusy(false)
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    clearContactSelection()
    const listRes = await apiClient.get<ContactsListResult>(`/api/contacts?${apiQuery}`)
    if (listRes.ok) setResult(listRes.data)
  }

  async function handleExport() {
    setExportBusy(true)
    const res = await apiClient.download(`/api/contacts/export${exportQuery}`)
    setExportBusy(false)
    if (!res.ok) notify.error(res.error)
  }

  const segments = options?.segments ?? []
  const listQuery = location.search
  const hasFilters =
    selectedSegments.length > 0 ||
    Boolean(searchParams.get('q')) ||
    Boolean(attrKey) ||
    showReplaced

  return (
    <WaSidebar
      title="Contactos"
      actions={
        <>
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void handleExport()}
            className="small-btn"
            title={
              hasFilters
                ? 'Exportar contactos que coinciden con los filtros actuales'
                : 'Exportar todos los contactos activos del área'
            }
          >
            {exportBusy ? '…' : hasFilters ? 'Exportar filtro' : 'Exportar todos'}
          </button>
          <Link to={`/contacts/import${listQuery}`} className="small-btn">
            Importar
          </Link>
          <Link to={`/contacts/new${listQuery}`} className="small-btn primary">
            +
          </Link>
        </>
      }
      filters={
        <div className="inbox-sidebar-filters space-y-2 px-3 pb-2">
          <form onSubmit={onSearchSubmit} className="flex gap-1">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar número o nombre"
              className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
            />
            <button type="submit" className="small-btn">
              Buscar
            </button>
          </form>

          {segments.length > 0 ? (
            <SegmentFilterSelect
              segments={segments}
              selectedSlugs={selectedSegments}
              onToggle={toggleSegment}
              onClearAll={() =>
                updateParams((sp) => {
                  sp.delete('segment')
                })
              }
            />
          ) : null}

          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={showReplaced}
                onChange={(e) =>
                  updateParams((sp) => {
                    if (e.target.checked) sp.set('show_replaced', '1')
                    else sp.delete('show_replaced')
                  })
                }
              />
              Reemplazados
            </label>

            <select
              value={attrKey}
              onChange={(e) =>
                updateParams((sp) => {
                  const value = e.target.value
                  if (value) sp.set('attr_key', value)
                  else sp.delete('attr_key')
                  if (!value) sp.delete('attr_value')
                })
              }
              className="max-w-[8rem] rounded border border-line bg-bg px-1 py-0.5"
            >
              <option value="">Atributo</option>
              {(options?.attribute_filters ?? []).map((opt) => (
                <option key={`${opt.slug}:${opt.segment_slug ?? ''}`} value={opt.slug}>
                  {opt.label}
                </option>
              ))}
            </select>

            {attrKey ? (
              <input
                type="search"
                value={attrValue}
                onChange={(e) =>
                  updateParams((sp) => {
                    const value = e.target.value
                    if (value) sp.set('attr_value', value)
                    else sp.delete('attr_value')
                  })
                }
                placeholder="Valor…"
                className="min-w-0 flex-1 rounded border border-line bg-bg px-1 py-0.5"
              />
            ) : null}
          </div>

          {result ? (
            <p className="text-xs text-muted">
              {result.total} contacto(s)
              {result.pages > 1 ? ` · pág. ${result.page}/${result.pages}` : ''}
            </p>
          ) : null}

          {result && result.items.length > 0 && segments.length > 0 && selectedIds.size > 0 ? (
            <form
              onSubmit={(e) => void handleBulkSegment(e)}
              className="flex flex-wrap items-end gap-1 text-xs"
            >
              <select
                value={bulkSegment}
                onChange={(e) => setBulkSegment(e.target.value)}
                required
                className="min-w-0 flex-1 rounded border border-line bg-bg px-1 py-0.5"
              >
                <option value="">Segmento bulk</option>
                {segments.map((seg) => (
                  <option key={seg.slug} value={seg.slug}>
                    {seg.label}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={bulkBusy || !bulkSegment}
                className="small-btn primary"
              >
                {bulkBusy ? '…' : `Aplicar (${selectedIds.size})`}
              </button>
            </form>
          ) : null}
        </div>
      }
    >
      {!result ? (
        <p className="inbox-empty-list">Cargando contactos…</p>
      ) : result.items.length === 0 ? (
        <p className="inbox-empty-list">
          {hasFilters
            ? 'No hay contactos con estos filtros.'
            : 'No hay contactos en esta área.'}
        </p>
      ) : (
        <>
          {segments.length > 0 ? (
            <div className="flex flex-wrap gap-1 border-b border-line px-3 py-1.5 text-xs">
              <button type="button" className="small-btn" onClick={selectAllContacts}>
                Todos
              </button>
              <button type="button" className="small-btn" onClick={clearContactSelection}>
                Ninguno
              </button>
            </div>
          ) : null}
          <ul className="inbox-chat-list">
            {result.items.map((contact) => {
              const active = selectedId === contact.id
              const displayName = formatContactName(
                contact.name,
                contact.last_name,
                contact.phone,
              )
              return (
                <li
                  key={contact.id}
                  role="link"
                  tabIndex={0}
                  className={`inbox-chat-item cursor-pointer ${active ? 'is-active' : ''}`}
                  onClick={() => navigate(`/contacts/${contact.id}${listQuery}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      navigate(`/contacts/${contact.id}${listQuery}`)
                    }
                  }}
                >
                  <div className="flex min-h-full w-full items-stretch">
                    {segments.length > 0 ? (
                      <label
                        className="flex items-center pl-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          checked={selectedIds.has(contact.id)}
                          onChange={() => toggleContactSelection(contact.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      </label>
                    ) : null}
                    <div className="inbox-chat-link flex-1 pointer-events-none">
                      <span className="inbox-chat-link-main">
                        <span className="inbox-chat-row-top">
                          <span className="inbox-chat-title">{displayName}</span>
                        </span>
                        {formatContactName(contact.name, contact.last_name) ? (
                          <span className="inbox-chat-preview font-mono">{contact.phone}</span>
                        ) : null}
                        {contact.segment_slugs.length > 0 ? (
                          <span
                            className="contact-segment-chips"
                            role="group"
                            aria-label="Segmentos"
                          >
                            {contact.segment_slugs.map((slug) => (
                              <SegmentBadge
                                key={slug}
                                colorKey={segmentColorKey(slug, segments)}
                                className="inbox-chat-segment"
                              >
                                {segmentLabel(slug, segments)}
                              </SegmentBadge>
                            ))}
                          </span>
                        ) : (
                          <span className="inbox-chat-preview">Sin segmento</span>
                        )}
                        {contact.replaced_by_contact_id || !contact.active ? (
                          <span className="inbox-chat-preview">
                            {contact.replaced_by_contact_id ? 'Reemplazado' : ''}
                            {contact.replaced_by_contact_id && !contact.active ? ' · ' : ''}
                            {!contact.active ? 'Inactivo' : ''}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
          {result.pages > 1 ? (
            <div className="flex items-center justify-center gap-2 border-t border-line p-2 text-sm">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                className="small-btn"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= result.pages}
                onClick={() => goToPage(page + 1)}
                className="small-btn"
              >
                Siguiente
              </button>
            </div>
          ) : null}
        </>
      )}
    </WaSidebar>
  )
}
