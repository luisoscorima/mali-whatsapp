import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'

type FilterOption = { value: string; label: string }

type AuditRow = {
  id: string
  created_display: string
  level: string
  event_type: string
  message: string
  actor_user_id: number | null
  actor_email: string | null
  area: string | null
  client_ip: string | null
  meta_summary: string
}

type AuditResult = {
  rows: AuditRow[]
  filters: { level: string; event: string; from: string; to: string }
  pagination: { page: number; total_pages: number; total: number }
  display_timezone: string
  retention_days: number
  area_scoped: boolean
  area_label: string | null
}

function levelClass(level: string): string {
  if (level === 'warn') return 'text-ink'
  if (level === 'error') return 'text-bad'
  return 'text-muted'
}

export function SettingsAuditPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [options, setOptions] = useState<{
    level_options: FilterOption[]
    event_options: FilterOption[]
  } | null>(null)
  const [data, setData] = useState<AuditResult | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const query = useMemo(
    () => ({
      level: searchParams.get('level') || '',
      event: searchParams.get('event') || '',
      from: searchParams.get('from') || '',
      to: searchParams.get('to') || '',
      page: searchParams.get('page') || '1',
    }),
    [searchParams],
  )

  useEffect(() => {
    apiClient
      .get<{ level_options: FilterOption[]; event_options: FilterOption[] }>(
        '/api/reports/audit-logs/options',
      )
      .then((result) => {
        if (result.ok) setOptions(result.data)
      })
  }, [])

  useEffect(() => {
    setError('')
    const qs = new URLSearchParams()
    if (query.level) qs.set('level', query.level)
    if (query.event) qs.set('event', query.event)
    if (query.from) qs.set('from', query.from)
    if (query.to) qs.set('to', query.to)
    if (query.page !== '1') qs.set('page', query.page)

    apiClient
      .get<AuditResult>(`/api/reports/audit-logs?${qs.toString()}`)
      .then((result) => {
        if (!result.ok) {
          setError(result.error)
          return
        }
        setData(result.data)
      })
  }, [query])

  function updateFilter(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'page') next.delete('page')
    setSearchParams(next)
  }

  function clearFilters() {
    setSearchParams(new URLSearchParams())
  }

  async function handleExport() {
    setBusy('export')
    const qs = new URLSearchParams()
    if (query.level) qs.set('level', query.level)
    if (query.event) qs.set('event', query.event)
    if (query.from) qs.set('from', query.from)
    if (query.to) qs.set('to', query.to)
    const path = `/api/reports/audit-logs/export?${qs.toString()}`
    const result = await apiClient.download(path)
    setBusy('')
    if (!result.ok) setError(result.error)
  }

  if (error && !data) {
    return <p className="text-bad">{error}</p>
  }

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
      <h2 className="text-lg font-semibold">Bitácora de auditoría</h2>
      {data ? (
        <p className="text-sm text-muted">
          Fechas en zona <strong>{data.display_timezone}</strong>. Retención máxima{' '}
          <strong>{data.retention_days}</strong> días.
          {data.area_scoped && data.area_label ? (
            <>
              {' '}
              Solo eventos del área <strong>{data.area_label}</strong>.
            </>
          ) : null}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 text-sm">
        <label>
          <span className="text-muted">Nivel</span>
          <select
            className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1.5"
            value={query.level}
            onChange={(e) => updateFilter('level', e.target.value)}
          >
            {(options?.level_options || [{ value: '', label: '…' }]).map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-muted">Tipo</span>
          <select
            className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1.5"
            value={query.event}
            onChange={(e) => updateFilter('event', e.target.value)}
          >
            {(options?.event_options || [{ value: '', label: '…' }]).map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-muted">Desde</span>
          <input
            type="date"
            className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1.5"
            value={query.from}
            onChange={(e) => updateFilter('from', e.target.value)}
          />
        </label>
        <label>
          <span className="text-muted">Hasta</span>
          <input
            type="date"
            className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1.5"
            value={query.to}
            onChange={(e) => updateFilter('to', e.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded-lg border border-line px-3 py-1.5 hover:bg-surface"
          onClick={() => clearFilters()}
        >
          Limpiar
        </button>
        <button
          type="button"
          className="rounded-lg bg-accent px-3 py-1.5 text-white hover:opacity-90 disabled:opacity-50"
          disabled={busy === 'export'}
          onClick={() => handleExport()}
        >
          {busy === 'export' ? '…' : 'Descargar Excel'}
        </button>
      </div>

      {error ? <p className="text-sm text-bad">{error}</p> : null}

      {!data ? (
        <p className="text-muted">Cargando…</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {data.pagination.total} evento(s) · página {data.pagination.page} de{' '}
            {data.pagination.total_pages}
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line bg-surface text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Fecha</th>
                  <th className="px-3 py-2">Nivel</th>
                  <th className="px-3 py-2">Tipo</th>
                  <th className="px-3 py-2">Mensaje</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Área</th>
                  <th className="px-3 py-2">Detalle</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-3 py-4 text-muted">
                      No hay eventos con los filtros actuales.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.id}>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {row.created_display}
                      </td>
                      <td className={`px-3 py-2 text-xs ${levelClass(row.level)}`}>
                        {row.level}
                      </td>
                      <td className="px-3 py-2 text-xs">{row.event_type}</td>
                      <td className="max-w-xs px-3 py-2">{row.message}</td>
                      <td className="px-3 py-2 text-xs text-muted">
                        {row.actor_email ||
                          (row.actor_user_id != null ? `#${row.actor_user_id}` : '—')}
                      </td>
                      <td className="px-3 py-2 text-xs">{row.area || '—'}</td>
                      <td className="max-w-xs px-3 py-2 text-xs text-muted">
                        {row.meta_summary}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2 text-sm">
            {data.pagination.page > 1 ? (
              <button
                type="button"
                className="rounded-lg border border-line px-2 py-1 hover:bg-surface"
                onClick={() =>
                  updateFilter('page', String(data.pagination.page - 1))
                }
              >
                ← Anterior
              </button>
            ) : null}
            {data.pagination.page < data.pagination.total_pages ? (
              <button
                type="button"
                className="rounded-lg border border-line px-2 py-1 hover:bg-surface"
                onClick={() =>
                  updateFilter('page', String(data.pagination.page + 1))
                }
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
