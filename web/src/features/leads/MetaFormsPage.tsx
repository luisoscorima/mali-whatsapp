import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { notify } from '@/shared/notify'
import { AREA_OPTIONS } from '../admin/areaLabels'
import { LeadOpenChatButton } from './LeadOpenChatButton'

type FormRow = {
  id: number
  form_id: string
  name: string | null
  lead_count: number
  last_sync_at: string | null
}

type FormRouteRow = {
  id: number
  form_id: string
  area: string
  form_name: string | null
  page_id: string | null
  area_locked: boolean
  last_synced_at: string | null
}

type LeadRow = {
  id: number
  leadgen_id: string
  form_id: string
  created_time: string | null
  chat_conversation_id: number | null
  came_with_inbound: boolean
  contacts: {
    id: number
    name: string
    phone: string | null
    email: string | null
    lead_status: { label: string } | null
  } | null
}

const ROUTE_AREA_OPTIONS = AREA_OPTIONS.filter((o) =>
  ['educacion', 'educacion_ca', 'educacion_ep'].includes(o.slug),
)

export function MetaFormsPage() {
  const [forms, setForms] = useState<FormRow[]>([])
  const [routes, setRoutes] = useState<FormRouteRow[]>([])
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [formId, setFormId] = useState('')
  const [busy, setBusy] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [routeBusyId, setRouteBusyId] = useState<string | null>(null)

  async function reload() {
    const [f, r, l] = await Promise.all([
      apiClient.get<FormRow[]>('/api/leads/meta-forms'),
      apiClient.get<FormRouteRow[]>('/api/leads/meta-forms/routes'),
      apiClient.get<LeadRow[]>('/api/leads/meta-forms/leads?limit=80'),
    ])
    if (f.ok) setForms(f.data)
    if (r.ok) setRoutes(r.data)
    if (l.ok) setLeads(l.data)
  }

  useEffect(() => {
    void reload()
  }, [])

  async function onBackfill(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const res = await apiClient.post<{ imported: number }>(
      '/api/leads/meta-forms/backfill',
      { form_id: formId.trim() },
    )
    setBusy(false)
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    notify.success(`Importados: ${res.data.imported}`)
    void reload()
  }

  async function onSyncForms() {
    setSyncBusy(true)
    const res = await apiClient.post<{
      synced: number
      created: number
      updated: number
    }>('/api/leads/meta-forms/sync-forms', {})
    setSyncBusy(false)
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    notify.success(
      `Sync: ${res.data.synced} forms (${res.data.created} nuevos, ${res.data.updated} actualizados)`,
    )
    void reload()
  }

  async function onRouteAreaChange(formIdValue: string, area: string) {
    setRouteBusyId(formIdValue)
    const res = await apiClient.patch<FormRouteRow>(
      `/api/leads/meta-forms/routes/${encodeURIComponent(formIdValue)}`,
      { area },
    )
    setRouteBusyId(null)
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    setRoutes((prev) =>
      prev.map((row) => (row.form_id === formIdValue ? res.data : row)),
    )
    notify.success('Área actualizada (manual)')
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <Link to="/leads" className="text-sm text-accent hover:underline">
          ← Leads
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Instant Forms</h1>
        <p className="text-sm text-muted">
          Leads de formularios Meta (Lead Ads). El área se decide por form_id
          (CA / EP / Educación). Requiere Page token para sync e ingestión.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-surface-strong p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-medium">Rutas form → área</h2>
            <p className="text-xs text-muted">
              Reglas: «Cursos de Arte…» → CA · «[FORM EP]» → EP · resto →
              Educación. Un cambio manual queda bloqueado al sincronizar.
            </p>
          </div>
          <button
            type="button"
            disabled={syncBusy}
            onClick={() => void onSyncForms()}
            className="rounded-lg border border-line bg-bg px-3 py-1.5 text-sm disabled:opacity-60"
          >
            {syncBusy ? 'Sincronizando…' : 'Sincronizar forms desde Meta'}
          </button>
        </div>
        {routes.length === 0 ? (
          <p className="text-sm text-muted">
            Aún no hay rutas. Sync desde Meta o espera el primer lead.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="px-2 py-2">Form ID</th>
                  <th className="px-2 py-2">Nombre</th>
                  <th className="px-2 py-2">Área</th>
                  <th className="px-2 py-2">Sync</th>
                </tr>
              </thead>
              <tbody>
                {routes.map((row) => (
                  <tr
                    key={row.form_id}
                    className="border-b border-line last:border-0"
                  >
                    <td className="px-2 py-2 font-mono text-xs">
                      {row.form_id}
                    </td>
                    <td className="px-2 py-2">
                      {row.form_name || '—'}
                      {row.area_locked ? (
                        <span className="ml-2 text-xs text-muted">manual</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      <select
                        className="rounded-lg border border-line bg-bg px-2 py-1"
                        value={row.area}
                        disabled={routeBusyId === row.form_id}
                        onChange={(e) =>
                          void onRouteAreaChange(row.form_id, e.target.value)
                        }
                      >
                        {ROUTE_AREA_OPTIONS.map((o) => (
                          <option key={o.slug} value={o.slug}>
                            {o.label}
                          </option>
                        ))}
                        {!ROUTE_AREA_OPTIONS.some((o) => o.slug === row.area) ? (
                          <option value={row.area}>{row.area}</option>
                        ) : null}
                      </select>
                    </td>
                    <td className="px-2 py-2 text-xs text-muted">
                      {row.last_synced_at
                        ? formatDateTime(row.last_synced_at)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <form
        onSubmit={onBackfill}
        className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface-strong p-4"
      >
        <label className="text-sm">
          <span className="text-muted">Form ID (backfill)</span>
          <input
            className="mt-1 block w-64 rounded-lg border border-line bg-bg px-3 py-2 font-mono text-sm"
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {busy ? 'Importando…' : 'Importar leads'}
        </button>
      </form>

      <section className="rounded-xl border border-line bg-surface-strong p-4">
        <h2 className="mb-3 font-medium">Formularios (área actual)</h2>
        {forms.length === 0 ? (
          <p className="text-sm text-muted">Ninguno aún.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {forms.map((f) => (
              <li key={f.id}>
                <span className="font-mono">{f.form_id}</span>
                {f.name ? ` · ${f.name}` : ''} · {f.lead_count} leads
                {f.last_sync_at
                  ? ` · sync ${formatDateTime(f.last_sync_at)}`
                  : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface-strong p-4">
        <h2 className="mb-3 font-medium">Leads recientes</h2>
        {leads.length === 0 ? (
          <p className="text-sm text-muted">Sin leads.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="px-2 py-2">Contacto</th>
                  <th className="px-2 py-2">Form</th>
                  <th className="px-2 py-2">Estado</th>
                  <th className="px-2 py-2">Chat</th>
                  <th className="px-2 py-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-line last:border-0"
                  >
                    <td className="px-2 py-2">
                      {lead.contacts ? (
                        <Link
                          to={`/contacts/${lead.contacts.id}`}
                          className="text-accent hover:underline"
                        >
                          {lead.contacts.name}
                          {lead.contacts.phone
                            ? ` · ${lead.contacts.phone}`
                            : ''}
                          {lead.contacts.email
                            ? ` · ${lead.contacts.email}`
                            : ''}
                        </Link>
                      ) : (
                        lead.leadgen_id
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono">{lead.form_id}</td>
                    <td className="px-2 py-2">
                      {lead.contacts?.lead_status?.label || '—'}
                    </td>
                    <td className="px-2 py-2">
                      <LeadOpenChatButton
                        contactId={lead.contacts?.id}
                        conversationId={lead.chat_conversation_id}
                        cameWithInbound={lead.came_with_inbound}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {formatDateTime(lead.created_time)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
