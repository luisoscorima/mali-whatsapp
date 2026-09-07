import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { SegmentFilterSelect } from '../segments/SegmentFilterSelect'
import { defaultReportDateRange } from '../reports/reportDateRange'

type TabId = 'communications' | 'segments' | 'chat'

type FilterOptions = {
  segments: { slug: string; label: string; color_key: string }[]
  attribute_filters: { slug: string; label: string; segment_slug?: string | null }[]
}

type CommRow = {
  phone: string
  name: string
  last_name: string
  email: string
  dni: string
  first_client_message_display: string
  first_client_message_preview: string
  last_client_message_display: string
  last_client_message_preview: string
  first_advisor_user: string
  first_advisor_message_display: string
  last_advisor_user: string
  last_advisor_message_display: string
  segments: string
  origins: string
  last_communication_by: string
  last_communication_display: string
  lead_status: string
  lead_score: string
}

type CommResult = {
  rows: CommRow[]
  pagination: { page: number; total_pages: number; total: number }
  area_label: string
  filters: {
    from: string
    to: string
    segment: string[]
    attr_key: string
    attr_value: string
  }
}

type SegmentHistRow = {
  id: string
  created_display: string
  contact_id: number | null
  phone: string
  name: string
  added: string
  removed: string
  segments: string
  actor_email: string
}

type SegmentHistResult = {
  rows: SegmentHistRow[]
  pagination: { page: number; total_pages: number; total: number }
  area_label: string
  filters: { from: string; to: string }
  note: string
}

type ChatHistRow = {
  id: string
  created_display: string
  event_type: string
  message: string
  phone: string
  conversation_id: number | null
  from_user: string
  to_user: string
  actor_email: string
}

type ChatHistResult = {
  rows: ChatHistRow[]
  pagination: { page: number; total_pages: number; total: number }
  area_label: string
  filters: { from: string; to: string }
  retention_days: number
  note: string
}

function tabFromParam(raw: string | null): TabId {
  if (raw === 'segments' || raw === 'chat') return raw
  return 'communications'
}

export function SettingsReporteriaPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [filterOptions, setFilterOptions] = useState<FilterOptions | null>(null)
  const [commData, setCommData] = useState<CommResult | null>(null)
  const [segData, setSegData] = useState<SegmentHistResult | null>(null)
  const [chatData, setChatData] = useState<ChatHistResult | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState('')
  const [rangeReady, setRangeReady] = useState(false)

  const tab = tabFromParam(searchParams.get('tab'))
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)
  const from = searchParams.get('from') || ''
  const to = searchParams.get('to') || ''
  const selectedSegments = searchParams.getAll('segment')
  const attrKey = searchParams.get('attr_key') ?? ''
  const attrValue = searchParams.get('attr_value') ?? ''

  useEffect(() => {
    const hasFrom = Boolean(searchParams.get('from'))
    const hasTo = Boolean(searchParams.get('to'))
    if (hasFrom && hasTo) {
      setRangeReady(true)
      return
    }
    const range = defaultReportDateRange()
    const next = new URLSearchParams(searchParams)
    if (!hasFrom) next.set('from', range.from)
    if (!hasTo) next.set('to', range.to)
    setSearchParams(next, { replace: true })
    setRangeReady(true)
  }, [searchParams, setSearchParams])

  useEffect(() => {
    apiClient.get<FilterOptions>('/api/contacts/filter-options').then((res) => {
      if (res.ok) setFilterOptions(res.data)
    })
  }, [])

  const filterQs = useMemo(() => {
    const qs = new URLSearchParams()
    if (from) qs.set('from', from)
    if (to) qs.set('to', to)
    if (page > 1) qs.set('page', String(page))
    for (const seg of selectedSegments) qs.append('segment', seg)
    if (attrKey) qs.set('attr_key', attrKey)
    if (attrValue) qs.set('attr_value', attrValue)
    return qs
  }, [from, to, page, selectedSegments, attrKey, attrValue])

  useEffect(() => {
    if (!rangeReady || !from || !to) return
    setLoadFailed(false)
    if (tab === 'communications') {
      const qs = filterQs.toString()
      apiClient
        .get<CommResult>(`/api/reports/communications${qs ? `?${qs}` : ''}`)
        .then((result) => {
          if (!result.ok) {
            notify.error(result.error)
            setLoadFailed(true)
            return
          }
          setCommData(result.data)
        })
      return
    }
    const qs = new URLSearchParams()
    qs.set('from', from)
    qs.set('to', to)
    if (page > 1) qs.set('page', String(page))
    const suffix = `?${qs.toString()}`
    if (tab === 'segments') {
      apiClient
        .get<SegmentHistResult>(`/api/reports/segment-history${suffix}`)
        .then((result) => {
          if (!result.ok) {
            notify.error(result.error)
            setLoadFailed(true)
            return
          }
          setSegData(result.data)
        })
      return
    }
    apiClient
      .get<ChatHistResult>(`/api/reports/conversation-history${suffix}`)
      .then((result) => {
        if (!result.ok) {
          notify.error(result.error)
          setLoadFailed(true)
          return
        }
        setChatData(result.data)
      })
  }, [tab, filterQs, from, to, page, rangeReady])

  function setTab(next: TabId) {
    const sp = new URLSearchParams(searchParams)
    sp.set('tab', next)
    sp.delete('page')
    setSearchParams(sp)
  }

  function updateParam(key: string, value: string) {
    const sp = new URLSearchParams(searchParams)
    if (value) sp.set(key, value)
    else sp.delete(key)
    sp.delete('page')
    setSearchParams(sp)
  }

  function toggleSegment(slug: string) {
    const sp = new URLSearchParams(searchParams)
    const current = sp.getAll('segment')
    sp.delete('segment')
    const next = current.includes(slug)
      ? current.filter((s) => s !== slug)
      : [...current, slug]
    for (const s of next) sp.append('segment', s)
    sp.delete('page')
    setSearchParams(sp)
  }

  function clearCommFilters() {
    const range = defaultReportDateRange()
    const sp = new URLSearchParams()
    sp.set('tab', 'communications')
    sp.set('from', range.from)
    sp.set('to', range.to)
    setSearchParams(sp)
  }

  async function handleExport() {
    setBusy('export')
    let path = '/api/reports/communications/export'
    const qs = new URLSearchParams()
    qs.set('from', from)
    qs.set('to', to)
    if (tab === 'communications') {
      for (const seg of selectedSegments) qs.append('segment', seg)
      if (attrKey) qs.set('attr_key', attrKey)
      if (attrValue) qs.set('attr_value', attrValue)
    } else if (tab === 'segments') {
      path = '/api/reports/segment-history/export'
    } else {
      path = '/api/reports/conversation-history/export'
    }
    const result = await apiClient.download(`${path}?${qs.toString()}`)
    setBusy('')
    if (!result.ok) notify.error(result.error)
  }

  function setPage(nextPage: number) {
    const sp = new URLSearchParams(searchParams)
    if (nextPage <= 1) sp.delete('page')
    else sp.set('page', String(nextPage))
    setSearchParams(sp)
  }

  const pagination =
    tab === 'communications'
      ? commData?.pagination
      : tab === 'segments'
        ? segData?.pagination
        : chatData?.pagination

  if (loadFailed && !commData && !segData && !chatData) {
    return <p className="text-muted">No se pudo cargar la reportería.</p>
  }

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
      <h2 className="text-lg font-semibold">Reportería</h2>

      <div className="flex flex-wrap gap-2 text-sm">
        {(
          [
            ['communications', 'Comunicaciones'],
            ['segments', 'Hist. segmentos'],
            ['chat', 'Hist. chat'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`rounded-lg px-3 py-1.5 ${
              tab === id
                ? 'bg-accent text-white'
                : 'border border-line hover:bg-surface'
            }`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="text-muted">Desde</span>
          <input
            type="date"
            className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1.5"
            value={from}
            onChange={(e) => updateParam('from', e.target.value)}
          />
        </label>
        <label>
          <span className="text-muted">Hasta</span>
          <input
            type="date"
            className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1.5"
            value={to}
            onChange={(e) => updateParam('to', e.target.value)}
          />
        </label>

        {tab === 'communications' ? (
          <>
            {filterOptions?.segments?.length ? (
              <SegmentFilterSelect
                segments={filterOptions.segments}
                selectedSlugs={selectedSegments}
                onToggle={toggleSegment}
                onClearAll={() => {
                  const sp = new URLSearchParams(searchParams)
                  sp.delete('segment')
                  sp.delete('page')
                  setSearchParams(sp)
                }}
              />
            ) : null}
            <label>
              <span className="text-muted">Atributo</span>
              <select
                className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1.5"
                value={attrKey}
                onChange={(e) => {
                  const sp = new URLSearchParams(searchParams)
                  if (e.target.value) sp.set('attr_key', e.target.value)
                  else {
                    sp.delete('attr_key')
                    sp.delete('attr_value')
                  }
                  sp.delete('page')
                  setSearchParams(sp)
                }}
              >
                <option value="">Todos</option>
                {(filterOptions?.attribute_filters ?? []).map((opt) => (
                  <option
                    key={`${opt.slug}:${opt.segment_slug ?? ''}`}
                    value={opt.slug}
                  >
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            {attrKey ? (
              <label>
                <span className="text-muted">Valor</span>
                <input
                  type="search"
                  className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1.5"
                  value={attrValue}
                  placeholder="Valor…"
                  onChange={(e) => updateParam('attr_value', e.target.value)}
                />
              </label>
            ) : null}
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 hover:bg-surface"
              onClick={() => clearCommFilters()}
            >
              Limpiar
            </button>
          </>
        ) : null}

        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-1.5 text-white hover:opacity-90 disabled:opacity-50"
          disabled={busy === 'export'}
          onClick={() => handleExport()}
        >
          {busy === 'export' ? 'Exportando…' : 'Descargar Excel'}
        </button>
      </div>

      {tab === 'communications' && commData ? (
        <p className="text-sm text-muted">
          Contactos del área <strong>{commData.area_label}</strong> con última
          interacción del cliente en el rango. Vista previa paginada; Excel hasta
          25 000 filas.
        </p>
      ) : null}
      {tab === 'segments' && segData ? (
        <p className="text-sm text-muted">
          {segData.note} Área <strong>{segData.area_label}</strong>.
        </p>
      ) : null}
      {tab === 'chat' && chatData ? (
        <p className="text-sm text-muted">
          {chatData.note} Área <strong>{chatData.area_label}</strong>.
        </p>
      ) : null}

      {!pagination ? (
        <p className="text-muted">Cargando…</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {pagination.total} registro(s) · página {pagination.page} de{' '}
            {pagination.total_pages}
          </p>

          {tab === 'communications' && commData ? (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-line bg-surface text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">Número</th>
                    <th className="px-3 py-2">Cliente</th>
                    <th className="px-3 py-2">1er / últ cliente</th>
                    <th className="px-3 py-2">1er / últ asesor</th>
                    <th className="px-3 py-2">Segmentos</th>
                    <th className="px-3 py-2">Origen</th>
                    <th className="px-3 py-2">Últ. por</th>
                    <th className="px-3 py-2">Lead</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {commData.rows.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-3 py-4 text-muted">
                        No hay contactos en el rango.
                      </td>
                    </tr>
                  ) : (
                    commData.rows.map((row) => (
                      <tr key={row.phone}>
                        <td className="px-3 py-2 font-mono text-xs">{row.phone}</td>
                        <td className="px-3 py-2">
                          {[row.name, row.last_name].filter(Boolean).join(' ') ||
                            '—'}
                          <br />
                          <span className="text-xs text-muted">
                            {row.email || '—'} · {row.dni || '—'}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.first_client_message_display}
                          <br />
                          {row.last_client_message_display}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.first_advisor_user || '—'} ·{' '}
                          {row.first_advisor_message_display}
                          <br />
                          {row.last_advisor_user || '—'} ·{' '}
                          {row.last_advisor_message_display}
                        </td>
                        <td className="max-w-[10rem] px-3 py-2 text-xs">
                          {row.segments || '—'}
                        </td>
                        <td className="max-w-[10rem] px-3 py-2 text-xs">
                          {row.origins || '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.last_communication_by || '—'}
                          <br />
                          {row.last_communication_display}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.lead_status || '—'}
                          {row.lead_score ? ` · ${row.lead_score}` : ''}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === 'segments' && segData ? (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-line bg-surface text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Contacto</th>
                    <th className="px-3 py-2">Agregados</th>
                    <th className="px-3 py-2">Quitados</th>
                    <th className="px-3 py-2">Resultantes</th>
                    <th className="px-3 py-2">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {segData.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-muted">
                        Sin eventos de segmentos en el rango.
                      </td>
                    </tr>
                  ) : (
                    segData.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {row.created_display}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.phone || '—'}
                          <br />
                          {row.name || '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">{row.added || '—'}</td>
                        <td className="px-3 py-2 text-xs">{row.removed || '—'}</td>
                        <td className="px-3 py-2 text-xs">{row.segments || '—'}</td>
                        <td className="px-3 py-2 text-xs">
                          {row.actor_email || '—'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === 'chat' && chatData ? (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-line bg-surface text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2">Fecha</th>
                    <th className="px-3 py-2">Tipo</th>
                    <th className="px-3 py-2">Teléfono</th>
                    <th className="px-3 py-2">De → A</th>
                    <th className="px-3 py-2">Actor</th>
                    <th className="px-3 py-2">Mensaje</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {chatData.rows.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-muted">
                        Sin eventos de chat en el rango.
                      </td>
                    </tr>
                  ) : (
                    chatData.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="whitespace-nowrap px-3 py-2 text-xs">
                          {row.created_display}
                        </td>
                        <td className="px-3 py-2 text-xs">{row.event_type}</td>
                        <td className="px-3 py-2 font-mono text-xs">
                          {row.phone || '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.from_user || '—'} → {row.to_user || '—'}
                        </td>
                        <td className="px-3 py-2 text-xs">
                          {row.actor_email || '—'}
                        </td>
                        <td className="max-w-[16rem] px-3 py-2 text-xs text-muted">
                          {row.message}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="flex gap-2 text-sm">
            {pagination.page > 1 ? (
              <button
                type="button"
                className="rounded-lg border border-line px-2 py-1 hover:bg-surface"
                onClick={() => setPage(pagination.page - 1)}
              >
                ← Anterior
              </button>
            ) : null}
            {pagination.page < pagination.total_pages ? (
              <button
                type="button"
                className="rounded-lg border border-line px-2 py-1 hover:bg-surface"
                onClick={() => setPage(pagination.page + 1)}
              >
                Siguiente →
              </button>
            ) : null}
          </div>
        </>
      )}
    </section>
  )
}
