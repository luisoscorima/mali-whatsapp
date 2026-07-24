import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
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
  const [chatOpeningId, setChatOpeningId] = useState<number | null>(null)
  const fabRef = useRef<HTMLDetailsElement>(null)

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

  useEffect(() => {
    function onPointerDown(ev: MouseEvent) {
      const fab = fabRef.current
      if (!fab?.open) return
      if (!fab.contains(ev.target as Node)) fab.open = false
    }
    document.addEventListener('click', onPointerDown)
    return () => document.removeEventListener('click', onPointerDown)
  }, [])

  function closeFab() {
    if (fabRef.current) fabRef.current.open = false
  }

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
    closeFab()
    if (!res.ok) notify.error(res.error)
  }

  async function openChat(contactId: number) {
    setChatOpeningId(contactId)
    const res = await apiClient.post<{ id: number }>(
      `/api/conversations/from-contact/${contactId}`,
      {},
    )
    setChatOpeningId(null)
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    navigate(`/conversations/${res.data.id}`)
  }

  const segments = options?.segments ?? []
  const listQuery = location.search
  const path = location.pathname
  const hasFilters =
    selectedSegments.length > 0 ||
    Boolean(searchParams.get('q')) ||
    Boolean(attrKey) ||
    showReplaced

  return (
    <WaSidebar
      title="Contactos"
      className="inbox-sidebar--contacts"
      floating={
        <details ref={fabRef} className="contact-fab">
          <summary
            className="contact-fab__trigger"
            title="Añadir, importar o exportar contactos"
            aria-label="Añadir, importar o exportar contactos"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
          </summary>
          <div className="contact-fab__menu" role="menu" aria-label="Acciones de contactos">
            <Link
              to={`/contacts/new${listQuery}`}
              className={`contact-fab__action ${path === '/contacts/new' ? 'is-active' : ''}`}
              role="menuitem"
              onClick={closeFab}
            >
              <span className="contact-fab__action-icon" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <line x1="19" y1="8" x2="19" y2="14" />
                  <line x1="22" y1="11" x2="16" y2="11" />
                </svg>
              </span>
              <span>Nuevo</span>
            </Link>
            <Link
              to={`/contacts/import${listQuery}`}
              className={`contact-fab__action ${path === '/contacts/import' ? 'is-active' : ''}`}
              role="menuitem"
              onClick={closeFab}
            >
              <span className="contact-fab__action-icon" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <path d="M12 18V9" />
                  <polyline points="9 12 12 9 15 12" />
                </svg>
              </span>
              <span>Importar</span>
            </Link>
            <button
              type="button"
              className="contact-fab__action"
              role="menuitem"
              disabled={exportBusy}
              title={
                hasFilters
                  ? 'Exportar contactos que coinciden con los filtros actuales'
                  : 'Exportar todos los contactos activos del área'
              }
              onClick={() => void handleExport()}
            >
              <span className="contact-fab__action-icon" aria-hidden="true">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <path d="M12 18V9" />
                  <polyline points="9 12 12 15 15 12" />
                </svg>
              </span>
              <span>
                {exportBusy ? 'Exportando…' : hasFilters ? 'Exportar filtro' : 'Exportar'}
              </span>
            </button>
          </div>
        </details>
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
              const detailHref = `/contacts/${contact.id}${listQuery}`
              return (
                <li
                  key={contact.id}
                  className={`inbox-chat-item ${active ? 'is-active' : ''}`}
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
                    <button
                      type="button"
                      className="inbox-chat-link flex-1 text-left"
                      onClick={() => navigate(detailHref)}
                    >
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
                    </button>
                    <div
                      className="contact-row-actions"
                      role="group"
                      aria-label="Acciones del contacto"
                    >
                      <button
                        type="button"
                        className="contact-row-action-btn"
                        title="Abrir chat"
                        aria-label="Abrir chat"
                        disabled={
                          chatOpeningId === contact.id ||
                          Boolean(contact.replaced_by_contact_id) ||
                          !contact.active
                        }
                        onClick={(e) => {
                          e.stopPropagation()
                          void openChat(contact.id)
                        }}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="17"
                          height="17"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                        </svg>
                      </button>
                      <Link
                        to={detailHref}
                        className={`contact-row-action-btn ${active ? 'is-active' : ''}`}
                        title="Editar contacto"
                        aria-label="Editar contacto"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="17"
                          height="17"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                          focusable="false"
                        >
                          <path d="M12 20h9" />
                          <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z" />
                        </svg>
                      </Link>
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
