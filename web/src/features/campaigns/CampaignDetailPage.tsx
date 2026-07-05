import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { CampaignShell } from './CampaignShell'
import { formatDateTime } from '../../shared/format'
import { formatContactName } from '../contacts/contactName'
import {
  filterCampaignLogs,
  filterIncidentLogs,
  INCIDENT_EXPORT_FILTERS,
  LOG_EXPORT_FILTERS,
} from './campaignLogFilters'
import {
  CampaignMessagePreview,
  type CampaignMessagePreviewData,
} from './CampaignMessagePreview'
import { MetricsGrid } from './MetricsGrid'
import { campaignStatusClass } from './campaignStatus'

type MetricCard = {
  label: string
  display: string
  displayLines?: string[] | null
  tone?: string
  tooltip?: string
}

type CampaignLog = {
  id: number
  phone: string
  status: string
  whatsapp_message_id?: string | null
  contact_name?: string
  segment_labels?: string
  created_at: string
}

type FailedLog = CampaignLog & {
  error_summary: string
  incident_type?: string
  incident_label?: string
}

type ResponderRow = {
  phone: string
  contact_name: string
  segment_labels: string
  first_response_at: string
  interactive_response_text: string
}

type RetryStats = {
  recoveredCount: number
  failedCount: number
  canManualRetry: boolean
  manualRetryCount: number
  maxManualRetries: number
  autoRetryDelayMinutes: number
  autoRetryPending: boolean
  autoRetryDone: boolean
}

type ParamSummaryItem = {
  label: string
  value: string
  kind: 'static' | 'dynamic'
}

type ExcludedContact = {
  id: number
  name: string
  last_name: string
  phone: string
}

type CampaignDetail = {
  id: number
  segment_display: string
  template_name: string
  template_id: number | null
  message_preview: CampaignMessagePreviewData | null
  param_summary: ParamSummaryItem[]
  exclude_segment_slugs: string[]
  exclude_contact_ids: number[]
  exclude_contacts: ExcludedContact[]
  first_send_at: string | null
  image_url: string | null
  message_text: string
  status: string
  total_recipients: number
  created_at: string
  scheduled_at: string | null
  analytics: {
    business: MetricCard[]
    globalResult: MetricCard[]
    performance: MetricCard[]
    funnel: MetricCard[]
    incidents: MetricCard[]
    cost: {
      amountDisplay: string
      perDeliveredDisplay: string
      sourceLabel: string
      hint: string
    }
    responseWindowDays: number
    performanceNote: string
    incidentsNote: string
  }
  logs: CampaignLog[]
  failed_logs: FailedLog[]
  retry_stats: RetryStats
  responder_metrics: {
    window_days: number
    responded_count: number
    responders: ResponderRow[]
    response_type_summary: { label: string; count: number }[]
  }
}

function actionButtonClass(secondary = false): string {
  return secondary
    ? 'rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-strong'
    : 'rounded-lg bg-accent px-3 py-1.5 text-sm text-white hover:opacity-90'
}

function selectClass(): string {
  return 'rounded-lg border border-line bg-surface px-2 py-1.5 text-sm'
}

export function CampaignDetailPage() {
  const { id } = useParams()
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [busy, setBusy] = useState('')
  const [logsFilter, setLogsFilter] = useState('all_current')
  const [incidentsFilter, setIncidentsFilter] = useState('all')
  const [logsViewFilter, setLogsViewFilter] = useState('all_current')
  const [showResponders, setShowResponders] = useState(false)

  async function reload() {
    if (!id) return
    const result = await apiClient.get<CampaignDetail>(`/api/campaigns/${id}`)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setCampaign(result.data)
  }

  useEffect(() => {
    reload()
  }, [id])

  const filteredLogs = useMemo(() => {
    if (!campaign) return []
    return filterCampaignLogs(campaign.logs, logsViewFilter).slice(0, 80)
  }, [campaign, logsViewFilter])

  const filteredFailed = useMemo(() => {
    if (!campaign) return []
    return filterIncidentLogs(campaign.failed_logs, incidentsFilter)
  }, [campaign, incidentsFilter])

  async function handleDownload(path: string, label: string) {
    setActionError('')
    setBusy(label)
    const result = await apiClient.download(path)
    setBusy('')
    if (!result.ok) {
      setActionError(result.error)
    }
  }

  async function handleSyncCost() {
    if (!id) return
    setActionError('')
    setBusy('sync')
    const result = await apiClient.post(`/api/campaigns/${id}/sync-cost`, {})
    setBusy('')
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    await reload()
  }

  async function handleRetryFailed() {
    if (!id) return
    if (
      !window.confirm(
        '¿Reintentar envíos fallidos elegibles de esta campaña?',
      )
    ) {
      return
    }
    setActionError('')
    setBusy('retry')
    const result = await apiClient.post<{
      retried: number
      recovered: number
      stillFailed: number
    }>(`/api/campaigns/${id}/retry-failed`, {})
    setBusy('')
    if (!result.ok) {
      setActionError(result.error)
      return
    }
    await reload()
  }

  if (error) {
    return (
      <CampaignShell>
        <p className="text-bad">{error}</p>
      </CampaignShell>
    )
  }

  if (!campaign) {
    return (
      <CampaignShell>
        <p className="text-muted">Cargando campaña…</p>
      </CampaignShell>
    )
  }

  const a = campaign.analytics
  const rs = campaign.retry_stats
  const rm = campaign.responder_metrics
  const campaignId = campaign.id

  const retryHintParts: string[] = []
  if (rs.recoveredCount > 0) {
    retryHintParts.push(`${rs.recoveredCount} recuperados tras reintento`)
  }
  if (rs.autoRetryPending) {
    retryHintParts.push(
      `Reintento automático pendiente (~${rs.autoRetryDelayMinutes} min)`,
    )
  } else {
    retryHintParts.push(
      `Reintento automático ~${rs.autoRetryDelayMinutes} min después del envío.`,
    )
  }
  if (rs.manualRetryCount > 0) {
    retryHintParts.push(
      `Reintentos manuales: ${rs.manualRetryCount}/${rs.maxManualRetries}`,
    )
  }
  if (rs.canManualRetry) {
    retryHintParts.push('Puedes reintentar fallidos manualmente.')
  }

  return (
    <CampaignShell selectedId={campaign.id}>
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">Campaña #{campaign.id}</h1>
        <span
          className={`rounded px-2 py-0.5 text-xs font-medium ${campaignStatusClass(campaign.status)}`}
        >
          {campaign.status}
        </span>
      </div>

      <p className="text-sm text-muted">
        {campaign.template_name} ·{' '}
        <span className="font-mono">{campaign.segment_display}</span>
      </p>

      {campaign.status === 'queued' || campaign.status === 'processing' ? (
        <p className="rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm">
          Envío en segundo plano. Recarga la página para ver el progreso.
        </p>
      ) : null}
      {campaign.status === 'scheduled' ? (
        <p className="rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm">
          Campaña programada: se enviará a la hora indicada.
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-line bg-surface-strong p-4">
          <h2 className="text-lg font-semibold">Detalle de campaña</h2>
          <p className="text-xs text-muted">
            Información general y contexto de la campaña.
          </p>
          <dl className="grid gap-2 text-sm">
            <div>
              <dt className="text-muted">Segmento(s)</dt>
              <dd className="font-mono">{campaign.segment_display}</dd>
            </div>
            <div>
              <dt className="text-muted">Fecha y hora de envío</dt>
              <dd>
                {campaign.first_send_at
                  ? formatDateTime(campaign.first_send_at)
                  : formatDateTime(campaign.created_at)}
              </dd>
            </div>
            {campaign.exclude_segment_slugs.length > 0 ||
            campaign.exclude_contacts.length > 0 ? (
              <div>
                <dt className="text-muted">Exclusiones</dt>
                <dd className="space-y-1">
                  {campaign.exclude_segment_slugs.length > 0 ? (
                    <p>Segmentos: {campaign.exclude_segment_slugs.join(', ')}</p>
                  ) : null}
                  {campaign.exclude_contacts.length > 0 ? (
                    <div>
                      <p className="mb-1">Contactos:</p>
                      <ul className="space-y-1">
                        {campaign.exclude_contacts.map((contact) => {
                          const label =
                            formatContactName(contact.name, contact.last_name) ||
                            `Contacto #${contact.id}`
                          return (
                            <li key={contact.id}>
                              <Link
                                to={`/contacts/${contact.id}`}
                                className="text-accent"
                              >
                                {label}
                              </Link>
                              {contact.phone ? (
                                <span className="font-mono text-muted">
                                  {' '}
                                  · {contact.phone}
                                </span>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  ) : null}
                </dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted">Plantilla</dt>
              <dd>
                {campaign.template_id ? (
                  <Link
                    to={`/templates/${campaign.template_id}`}
                    className="font-mono text-accent"
                  >
                    {campaign.template_name}
                  </Link>
                ) : (
                  <span className="font-mono">{campaign.template_name}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Estado</dt>
              <dd>
                <span
                  className={`rounded px-2 py-0.5 text-xs font-medium ${campaignStatusClass(campaign.status)}`}
                >
                  {campaign.status}
                </span>
              </dd>
            </div>
            {campaign.scheduled_at ? (
              <div>
                <dt className="text-muted">Programada para</dt>
                <dd>{formatDateTime(campaign.scheduled_at)}</dd>
              </div>
            ) : null}
            {campaign.retry_stats.recoveredCount > 0 ? (
              <div>
                <dt className="text-muted">Recuperados en reintento</dt>
                <dd>{campaign.retry_stats.recoveredCount}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-muted">Parámetros</dt>
              <dd>
                {campaign.param_summary.length === 0 ? (
                  '—'
                ) : (
                  <ul className="space-y-1">
                    {campaign.param_summary.map((row) => (
                      <li key={row.label}>
                        <strong>{row.label}:</strong>{' '}
                        <span className="font-mono">{row.value}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </div>
            {campaign.image_url ? (
              <div>
                <dt className="text-muted">Imagen</dt>
                <dd>
                  <a
                    href={campaign.image_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent"
                  >
                    Abrir enlace
                  </a>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        {campaign.message_preview ? (
          <section className="rounded-xl border border-line bg-surface-strong p-4">
            <details open>
              <summary className="cursor-pointer text-lg font-semibold">
                Vista previa
              </summary>
              <div className="mt-4">
                <CampaignMessagePreview preview={campaign.message_preview} />
              </div>
            </details>
          </section>
        ) : null}
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-muted">Destinatarios</dt>
          <dd>{campaign.total_recipients}</dd>
        </div>
        <div>
          <dt className="text-muted">Creada</dt>
          <dd>{formatDateTime(campaign.created_at)}</dd>
        </div>
        {campaign.scheduled_at ? (
          <div>
            <dt className="text-muted">Programada</dt>
            <dd>{formatDateTime(campaign.scheduled_at)}</dd>
          </div>
        ) : null}
      </dl>

      <div className="flex flex-wrap items-center gap-2">
        <label className="text-sm text-muted">
          Exportar registro
          <select
            className={`${selectClass()} ml-2`}
            value={logsFilter}
            onChange={(e) => setLogsFilter(e.target.value)}
          >
            {LOG_EXPORT_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={actionButtonClass(true)}
          disabled={busy !== ''}
          onClick={() =>
            handleDownload(
              `/api/campaigns/${campaignId}/logs-export?filter=${encodeURIComponent(logsFilter)}`,
              'logs',
            )
          }
        >
          {busy === 'logs' ? 'Exportando…' : 'Excel'}
        </button>
        <button
          type="button"
          className={actionButtonClass(true)}
          disabled={busy !== ''}
          onClick={() => handleSyncCost()}
        >
          {busy === 'sync' ? 'Sincronizando…' : 'Sincronizar costo'}
        </button>
      </div>

      {actionError ? <p className="text-sm text-bad">{actionError}</p> : null}

      <div className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
        <MetricsGrid title="Negocio" metrics={a.business} />
        <p className="text-xs text-muted">
          {a.cost.sourceLabel}: {a.cost.amountDisplay} ·{' '}
          {a.cost.perDeliveredDisplay} por entregado. {a.cost.hint}
        </p>
        <MetricsGrid title="Resultado" metrics={a.globalResult} />
        <MetricsGrid title="Rendimiento" metrics={a.performance} />
        <p className="text-xs text-muted">{a.performanceNote}</p>
        <details className="text-sm">
          <summary className="cursor-pointer font-medium">Embudo Meta</summary>
          <div className="mt-3">
            <MetricsGrid title="" metrics={a.funnel} />
          </div>
        </details>
        <MetricsGrid title="Incidencias" metrics={a.incidents} />
        {a.incidentsNote ? (
          <p className="text-xs text-muted">{a.incidentsNote}</p>
        ) : null}
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Respuestas ({rm.responded_count})
          </h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={actionButtonClass(true)}
              disabled={rm.responded_count === 0}
              onClick={() => setShowResponders((v) => !v)}
            >
              {showResponders ? 'Ocultar' : 'Ver teléfonos'}
            </button>
            <button
              type="button"
              className={actionButtonClass(true)}
              disabled={busy !== '' || rm.responded_count === 0}
              onClick={() =>
                handleDownload(
                  `/api/campaigns/${campaignId}/responders-export`,
                  'responders',
                )
              }
            >
              {busy === 'responders' ? 'Exportando…' : 'Exportar Excel'}
            </button>
          </div>
        </div>
        <p className="text-xs text-muted">
          Ventana de {rm.window_days} días tras el envío.
          {a.responseWindowDays
            ? ` Métrica «Respuestas únicas» usa la misma ventana.`
            : ''}
        </p>
        {rm.response_type_summary.length > 0 ? (
          <p className="text-sm text-muted">
            {rm.response_type_summary
              .map((item) => `${item.label}: ${item.count}`)
              .join(' · ')}
          </p>
        ) : null}
        {showResponders && rm.responders.length > 0 ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface-strong text-sm">
            {rm.responders.map((row) => (
              <li key={row.phone} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono">{row.phone}</span>
                  <span className="text-xs text-muted">
                    {formatDateTime(row.first_response_at)}
                  </span>
                </div>
                <p>
                  {row.contact_name || '—'}
                  {row.segment_labels ? ` · ${row.segment_labels}` : ''}
                </p>
                {row.interactive_response_text ? (
                  <p className="text-accent">{row.interactive_response_text}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Registro de envíos</h2>
          <label className="text-sm text-muted">
            Filtro
            <select
              className={`${selectClass()} ml-2`}
              value={logsViewFilter}
              onChange={(e) => setLogsViewFilter(e.target.value)}
            >
              {LOG_EXPORT_FILTERS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {filteredLogs.length === 0 ? (
          <p className="text-sm text-muted">Sin registros para este filtro.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface-strong text-sm">
            {filteredLogs.map((log) => (
              <li key={log.id} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono">{log.phone}</span>
                  <span className="text-xs">{log.status}</span>
                </div>
                <p>
                  {log.contact_name || '—'}
                  {log.segment_labels ? ` · ${log.segment_labels}` : ''}
                </p>
                <p className="text-xs text-muted">
                  {formatDateTime(log.created_at)}
                  {log.whatsapp_message_id
                    ? ` · ${log.whatsapp_message_id}`
                    : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Fallidos ({filteredFailed.length}
            {incidentsFilter !== 'all'
              ? ` / ${campaign.failed_logs.length}`
              : ''}
            )
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-muted">
              Exportar
              <select
                className={`${selectClass()} ml-2`}
                value={incidentsFilter}
                onChange={(e) => setIncidentsFilter(e.target.value)}
              >
                {INCIDENT_EXPORT_FILTERS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className={actionButtonClass(true)}
              disabled={busy !== '' || campaign.failed_logs.length === 0}
              onClick={() =>
                handleDownload(
                  `/api/campaigns/${campaignId}/failed-export`,
                  'failed',
                )
              }
            >
              {busy === 'failed' ? '…' : 'CSV'}
            </button>
            <button
              type="button"
              className={actionButtonClass(true)}
              disabled={busy !== '' || campaign.failed_logs.length === 0}
              onClick={() =>
                handleDownload(
                  `/api/campaigns/${campaignId}/incidents-export?filter=${encodeURIComponent(incidentsFilter)}`,
                  'incidents',
                )
              }
            >
              {busy === 'incidents' ? '…' : 'Excel'}
            </button>
          </div>
        </div>

        <p className="text-xs text-muted">{retryHintParts.join(' · ')}</p>
        {rs.canManualRetry ? (
          <button
            type="button"
            className={actionButtonClass()}
            disabled={busy !== ''}
            onClick={() => handleRetryFailed()}
          >
            {busy === 'retry' ? 'Reintentando…' : 'Reintentar fallidos'}
          </button>
        ) : null}

        {filteredFailed.length === 0 ? (
          <p className="text-sm text-muted">Sin incidencias para este filtro.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface-strong text-sm">
            {filteredFailed.map((log) => (
              <li key={log.id} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-mono">{log.phone}</span>
                  <span className="text-xs text-bad">{log.status}</span>
                </div>
                <p>
                  {log.contact_name || '—'}
                  {log.segment_labels ? ` · ${log.segment_labels}` : ''}
                  {log.incident_label ? ` · ${log.incident_label}` : ''}
                </p>
                <p className="text-bad">{log.error_summary}</p>
                <p className="text-xs text-muted">
                  {formatDateTime(log.created_at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
    </CampaignShell>
  )
}
