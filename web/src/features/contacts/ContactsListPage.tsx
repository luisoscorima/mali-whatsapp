import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatContactName } from './contactName'
import { segmentToneClass } from '../segments/segmentColors'
import { WaSpanMainPage } from '@/shared/ui/shell/WaSpanMainPage'

const SEGMENT_NONE = '__none__'

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

export function ContactsListPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [options, setOptions] = useState<FilterOptions | null>(null)
  const [result, setResult] = useState<ContactsListResult | null>(null)
  const [error, setError] = useState('')
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

  useEffect(() => {
    setError('')
    apiClient.get<ContactsListResult>(`/api/contacts?${apiQuery}`).then((res) => {
      if (!res.ok) {
        setError(res.error)
        return
      }
      setResult(res.data)
    })
  }, [apiQuery])

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

  function toggleNoneSegment() {
    updateParams((sp) => {
      const current = sp.getAll('segment')
      sp.delete('segment')
      if (current.includes(SEGMENT_NONE)) {
        current.filter((s) => s !== SEGMENT_NONE).forEach((s) => sp.append('segment', s))
      } else {
        [...current, SEGMENT_NONE].forEach((s) => sp.append('segment', s))
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
    setError('')
    const res = await apiClient.post<{ updated: number }>(
      '/api/contacts/bulk-add-segment',
      {
        segment_slug: bulkSegment,
        contact_ids: [...selectedIds],
      },
    )
    setBulkBusy(false)
    if (!res.ok) {
      setError(res.error)
      return
    }
    clearContactSelection()
    const listRes = await apiClient.get<ContactsListResult>(`/api/contacts?${apiQuery}`)
    if (listRes.ok) setResult(listRes.data)
  }

  async function handleExport() {
    setExportBusy(true)
    setError('')
    const res = await apiClient.download(`/api/contacts/export${exportQuery}`)
    setExportBusy(false)
    if (!res.ok) setError(res.error)
  }

  const segments = options?.segments ?? []
  const hasFilters =
    selectedSegments.length > 0 ||
    Boolean(searchParams.get('q')) ||
    Boolean(attrKey) ||
    showReplaced

  return (
    <WaSpanMainPage>
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Contactos</h1>
          <p className="text-sm text-muted">
            Lista filtrable por segmento, búsqueda y atributos.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={exportBusy}
            onClick={() => void handleExport()}
            className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-accent-soft disabled:opacity-50"
          >
            {exportBusy ? 'Exportando…' : 'Exportar Excel'}
          </button>
          <Link
            to="/contacts/import"
            className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-accent-soft"
          >
            Importar
          </Link>
          <Link
            to="/contacts/new"
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white"
          >
            + Añadir contacto
          </Link>
        </div>
      </div>

      <div className="space-y-3 rounded-xl border border-line bg-surface-strong p-4">
        <form onSubmit={onSearchSubmit} className="flex flex-wrap gap-2">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar número o nombre"
            className="min-w-[14rem] flex-1 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border border-line px-4 py-2 text-sm hover:bg-accent-soft"
          >
            Buscar
          </button>
        </form>

        {segments.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {segments.map((seg) => {
              const active = selectedSegments.includes(seg.slug)
              return (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => toggleSegment(seg.slug)}
                  className={`rounded-full px-3 py-1 text-xs ${
                    active
                      ? segmentToneClass(seg.color_key)
                      : 'border border-line text-muted'
                  }`}
                >
                  {seg.label}
                </button>
              )
            })}
            <button
              type="button"
              onClick={toggleNoneSegment}
              className={`rounded-full px-3 py-1 text-xs ${
                selectedSegments.includes(SEGMENT_NONE)
                  ? 'bg-slate-500/20 text-slate-700 dark:text-slate-300'
                  : 'border border-line text-muted'
              }`}
            >
              Sin segmento
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-3 text-sm">
          <label className="flex items-center gap-2">
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
            Mostrar reemplazados
          </label>

          <label>
            <span className="text-muted">Atributo</span>
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
              className="ml-2 rounded-lg border border-line bg-bg px-2 py-1"
            >
              <option value="">Todos</option>
              {(options?.attribute_filters ?? []).map((opt) => (
                <option key={`${opt.slug}:${opt.segment_slug ?? ''}`} value={opt.slug}>
                  {opt.label}
                  {opt.segment_slug ? ` (${opt.segment_slug})` : ''}
                </option>
              ))}
            </select>
          </label>

          {attrKey ? (
            <label>
              <span className="text-muted">Valor</span>
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
                placeholder="Contiene…"
                className="ml-2 rounded-lg border border-line bg-bg px-2 py-1"
              />
            </label>
          ) : null}
        </div>
      </div>

      {error ? <p className="text-bad">{error}</p> : null}

      {!result ? (
        <p className="text-muted">Cargando contactos…</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {result.total} contacto(s)
            {result.pages > 1 ? ` · página ${result.page} de ${result.pages}` : ''}
          </p>

          {result.items.length > 0 && segments.length > 0 ? (
            <div className="space-y-2 rounded-xl border border-line bg-surface-strong p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-accent-soft"
                  onClick={selectAllContacts}
                >
                  Seleccionar todos
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-accent-soft"
                  onClick={clearContactSelection}
                >
                  Quitar selección
                </button>
                {selectedIds.size > 0 ? (
                  <span className="text-muted">{selectedIds.size} seleccionado(s)</span>
                ) : null}
              </div>
              {selectedIds.size > 0 ? (
                <form
                  onSubmit={(e) => void handleBulkSegment(e)}
                  className="flex flex-wrap items-end gap-2"
                >
                  <label className="min-w-[200px] flex-1">
                    <span className="text-muted">Asignar segmento</span>
                    <select
                      value={bulkSegment}
                      onChange={(e) => setBulkSegment(e.target.value)}
                      required
                      className="mt-1 w-full rounded-lg border border-line bg-bg px-2 py-1"
                    >
                      <option value="">— Segmento —</option>
                      {segments.map((seg) => (
                        <option key={seg.slug} value={seg.slug}>
                          {seg.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    disabled={bulkBusy || !bulkSegment}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white disabled:opacity-50"
                  >
                    {bulkBusy ? 'Aplicando…' : 'Aplicar'}
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}

          {result.items.length === 0 ? (
            <p className="text-sm text-muted">
              {hasFilters
                ? 'No hay contactos con estos filtros.'
                : 'No hay contactos en esta área.'}
            </p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line bg-surface-strong">
              {result.items.map((contact) => (
                <li key={contact.id} className="flex items-stretch">
                  {segments.length > 0 ? (
                    <label className="flex items-center px-3">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(contact.id)}
                        onChange={() => toggleContactSelection(contact.id)}
                      />
                    </label>
                  ) : null}
                  <Link
                    to={`/contacts/${contact.id}`}
                    className="block flex-1 px-4 py-3 hover:bg-accent-soft"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                      <p className="font-medium">
                        {formatContactName(
                          contact.name,
                          contact.last_name,
                          contact.phone,
                        )}
                        {contact.replaced_by_contact_id ? (
                          <span className="ml-2 text-xs text-muted">(reemplazado)</span>
                        ) : null}
                        {!contact.active ? (
                          <span className="ml-2 text-xs text-muted">(inactivo)</span>
                        ) : null}
                      </p>
                      {formatContactName(contact.name, contact.last_name) ? (
                        <p className="font-mono text-sm text-muted">{contact.phone}</p>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {contact.segment_slugs.length === 0 ? (
                          <span className="text-xs text-muted">Sin segmento</span>
                        ) : (
                          contact.segment_slugs.map((slug) => {
                            const seg = segments.find((s) => s.slug === slug)
                            return (
                              <span
                                key={slug}
                                className={`rounded px-2 py-0.5 text-xs ${segmentToneClass(seg?.color_key)}`}
                              >
                                {segmentLabel(slug, segments)}
                              </span>
                            )
                          })
                        )}
                      </div>
                    </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {result.pages > 1 ? (
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={page >= result.pages}
                onClick={() => goToPage(page + 1)}
                className="rounded-lg border border-line px-3 py-1.5 text-sm disabled:opacity-40"
              >
                Siguiente
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
    </WaSpanMainPage>
  )
}
