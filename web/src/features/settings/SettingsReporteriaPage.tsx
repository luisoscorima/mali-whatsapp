import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'

type ReportRow = {
  phone: string
  name: string
  first_communication_display: string
  initiated_by: string
  message1_preview: string
  message2_preview: string
  message1: string
  message2: string
  last_communication_display: string
  last_communication_by: string
  last_client_message_preview: string
  last_team_message_preview: string
  last_client_message: string
  last_team_message: string
}

type ReportResult = {
  rows: ReportRow[]
  pagination: { page: number; total_pages: number; total: number }
  area_label: string
}

export function SettingsReporteriaPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [data, setData] = useState<ReportResult | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState('')

  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1)

  useEffect(() => {
    setLoadFailed(false)
    const qs = page > 1 ? `?page=${page}` : ''
    apiClient
      .get<ReportResult>(`/api/reports/communications${qs}`)
      .then((result) => {
        if (!result.ok) {
          notify.error(result.error)
          setLoadFailed(true)
          return
        }
        setData(result.data)
      })
  }, [page])

  async function handleExport() {
    setBusy('export')
    const result = await apiClient.download('/api/reports/communications/export')
    setBusy('')
    if (!result.ok) notify.error(result.error)
  }

  if (loadFailed && !data) {
    return <p className="text-muted">No se pudo cargar la reportería.</p>
  }

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
      <h2 className="text-lg font-semibold">Reportería</h2>
      {data ? (
        <p className="text-sm text-muted">
          Contactos del área <strong>{data.area_label}</strong> con al menos un
          mensaje en el chat. Vista previa paginada; el Excel incluye todos los
          registros.
        </p>
      ) : null}

      <button
        type="button"
        className="rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:opacity-50"
        disabled={busy === 'export'}
        onClick={() => handleExport()}
      >
        {busy === 'export' ? 'Exportando…' : 'Descargar Excel'}
      </button>

      {!data ? (
        <p className="text-muted">Cargando…</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {data.pagination.total} contacto(s) · página {data.pagination.page}{' '}
            de {data.pagination.total_pages}
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-line bg-surface text-xs text-muted">
                <tr>
                  <th className="px-3 py-2">Número</th>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">1.ª comunicación</th>
                  <th className="px-3 py-2">Iniciada por</th>
                  <th className="px-3 py-2">Inicio (2 msgs)</th>
                  <th className="px-3 py-2">Última comunicación</th>
                  <th className="px-3 py-2">Última por</th>
                  <th className="px-3 py-2">Cola cliente</th>
                  <th className="px-3 py-2">Cola equipo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {data.rows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-muted">
                      No hay contactos con mensajes en esta área.
                    </td>
                  </tr>
                ) : (
                  data.rows.map((row) => (
                    <tr key={row.phone}>
                      <td className="px-3 py-2 font-mono text-xs">{row.phone}</td>
                      <td className="px-3 py-2">{row.name || '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {row.first_communication_display}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.initiated_by || '—'}
                      </td>
                      <td className="max-w-[14rem] px-3 py-2 text-xs text-muted">
                        {row.message1_preview ? (
                          <span title={row.message1}>1: {row.message1_preview}</span>
                        ) : null}
                        {row.message2_preview ? (
                          <>
                            <br />
                            <span title={row.message2}>
                              2: {row.message2_preview}
                            </span>
                          </>
                        ) : null}
                        {!row.message1_preview && !row.message2_preview ? '—' : null}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs">
                        {row.last_communication_display}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {row.last_communication_by || '—'}
                      </td>
                      <td
                        className="max-w-[12rem] px-3 py-2 text-xs text-muted"
                        title={row.last_client_message}
                      >
                        {row.last_client_message_preview || '—'}
                      </td>
                      <td
                        className="max-w-[12rem] px-3 py-2 text-xs text-muted"
                        title={row.last_team_message}
                      >
                        {row.last_team_message_preview || '—'}
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
                onClick={() => setSearchParams({ page: String(page - 1) })}
              >
                ← Anterior
              </button>
            ) : null}
            {data.pagination.page < data.pagination.total_pages ? (
              <button
                type="button"
                className="rounded-lg border border-line px-2 py-1 hover:bg-surface"
                onClick={() => setSearchParams({ page: String(page + 1) })}
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
