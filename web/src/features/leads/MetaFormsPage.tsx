import { type FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { notify } from '@/shared/notify'
import { LeadOpenChatButton } from './LeadOpenChatButton'

type FormRow = {
  id: number
  form_id: string
  name: string | null
  lead_count: number
  last_sync_at: string | null
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

export function MetaFormsPage() {
  const [forms, setForms] = useState<FormRow[]>([])
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [formId, setFormId] = useState('')
  const [busy, setBusy] = useState(false)

  async function reload() {
    const [f, l] = await Promise.all([
      apiClient.get<FormRow[]>('/api/leads/meta-forms'),
      apiClient.get<LeadRow[]>('/api/leads/meta-forms/leads?limit=80'),
    ])
    if (f.ok) setForms(f.data)
    if (l.ok) setLeads(l.data)
  }

  useEffect(() => {
    void reload()
  }, [])

  async function onBackfill(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    const r = await apiClient.post<{ imported: number }>(
      '/api/leads/meta-forms/backfill',
      { form_id: formId.trim() },
    )
    setBusy(false)
    if (!r.ok) {
      notify.error(r.error)
      return
    }
    notify.success(`Importados: ${r.data.imported}`)
    void reload()
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <Link to="/leads" className="text-sm text-accent hover:underline">
          ← Leads
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Instant Forms</h1>
        <p className="text-sm text-muted">
          Leads de formularios Meta (Lead Ads). Requiere Page token configurado.
        </p>
      </div>

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
        <h2 className="mb-3 font-medium">Formularios</h2>
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
                  <tr key={lead.id} className="border-b border-line last:border-0">
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
