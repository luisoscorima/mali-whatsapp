import { type FormEvent, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { notify } from '@/shared/notify'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'

type MetaAdDetail = {
  id: number
  meta_source_id: string
  display_name: string | null
  display_label: string
  platform_label: string
  source_url: string | null
  source_type: string | null
  headline: string | null
  body: string | null
  media_type: string | null
  image_url: string | null
  lead_count: number
  first_seen_at: string | null
  last_seen_at: string | null
}

type MetaAdLead = {
  phone: string
  first_message_at: string | null
  contact_name: string | null
  contact_id: number | null
  contact_email: string | null
  lead_status: { label: string } | null
  conversation_id: number | null
  conversation_status: string | null
  assigned_user: { name: string; email: string } | null
}

type DetailPayload = {
  ad: MetaAdDetail
  leads: MetaAdLead[]
}

export function MetaAdDetailPage() {
  const { id } = useParams()
  const [payload, setPayload] = useState<DetailPayload | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    apiClient.get<DetailPayload>(`/api/meta-ads/${id}`).then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        setLoadFailed(true)
        return
      }
      setPayload(result.data)
      setDisplayName(result.data.ad.display_name ?? '')
    })
  }, [id])

  async function onSaveName(e: FormEvent) {
    e.preventDefault()
    if (!id) return
    setSaving(true)
    const result = await apiClient.patch<MetaAdDetail>(`/api/meta-ads/${id}`, {
      display_name: displayName,
    })
    setSaving(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setPayload((prev) =>
      prev ? { ...prev, ad: { ...prev.ad, ...result.data } } : prev,
    )
    notify.success('Nombre guardado.')
  }

  if (loadFailed) {
    return <p className="text-muted">No se pudo cargar</p>
  }

  if (!payload) {
    return <p className="text-muted">Cargando anuncio…</p>
  }

  const { ad, leads } = payload

  return (
    <div className="space-y-6">
      <div>
        <Link to="/leads/meta-ctwa" className="inbox-back-mobile">
          ← CTWA
        </Link>
        <Link to="/leads/meta-ctwa" className="text-sm text-accent hover:underline max-md:hidden">
          ← CTWA
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{ad.display_label}</h1>
        <p className="font-mono text-sm text-muted">
          ID Meta: {ad.meta_source_id} · {ad.platform_label}
        </p>
      </div>

      <section className="rounded-xl border border-line bg-surface-strong p-4">
        <h2 className="mb-2 font-medium">Nombre del anuncio</h2>
        <p className="mb-3 text-sm text-muted">
          Opcional. Más adelante se podrá sincronizar desde la API de Meta Ads.
        </p>
        <form onSubmit={onSaveName} className="flex max-w-md flex-col gap-3">
          <label className="text-sm">
            <span className="text-muted">Nombre visible</span>
            <input
              type="text"
              maxLength={200}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ej. Promoción marzo 2026"
              className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
            />
          </label>
          <button
            type="submit"
            disabled={saving}
            className="w-fit rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {saving ? 'Guardando…' : 'Guardar nombre'}
          </button>
        </form>
      </section>

      <section className="rounded-xl border border-line bg-surface-strong p-4">
        <h2 className="mb-3 font-medium">Datos del anuncio</h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Plataforma</dt>
            <dd>{ad.platform_label}</dd>
          </div>
          <div>
            <dt className="text-muted">Tipo origen</dt>
            <dd>{ad.source_type || '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">URL</dt>
            <dd>
              {ad.source_url ? (
                <a
                  href={ad.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-accent hover:underline"
                >
                  {ad.source_url}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Creativo</dt>
            <dd className="mt-1">
              {ad.image_url ? (
                <img
                  src={ad.image_url}
                  alt=""
                  className="max-h-48 rounded-lg border border-line object-contain"
                />
              ) : (
                '—'
              )}
              {ad.media_type ? (
                <span className="mt-1 block text-muted">{ad.media_type}</span>
              ) : null}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Headline</dt>
            <dd>{ad.headline || '—'}</dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted">Body</dt>
            <dd>{ad.body || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted">Leads</dt>
            <dd>{ad.lead_count}</dd>
          </div>
          <div>
            <dt className="text-muted">Primer / último contacto</dt>
            <dd>
              {formatDateTime(ad.first_seen_at)} · {formatDateTime(ad.last_seen_at)}
            </dd>
          </div>
        </dl>
      </section>

      <section className="rounded-xl border border-line bg-surface-strong p-4">
        <h2 className="mb-3 font-medium">Personas desde este anuncio ({leads.length})</h2>
        {leads.length === 0 ? (
          <p className="text-sm text-muted">Sin leads vinculados aún.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-muted">
                <tr>
                  <th className="px-2 py-2 font-medium">Nombre</th>
                  <th className="px-2 py-2 font-medium">Teléfono</th>
                  <th className="px-2 py-2 font-medium">Estado</th>
                  <th className="px-2 py-2 font-medium">Asignado</th>
                  <th className="px-2 py-2 font-medium">Primer mensaje</th>
                  <th className="px-2 py-2 font-medium">
                    <span className="sr-only">Chat</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.phone} className="border-b border-line last:border-0">
                    <td className="px-2 py-2">
                      {lead.contact_id ? (
                        <Link
                          to={`/contacts/${lead.contact_id}`}
                          className="text-accent hover:underline"
                        >
                          {lead.contact_name || '—'}
                        </Link>
                      ) : (
                        lead.contact_name || '—'
                      )}
                    </td>
                    <td className="px-2 py-2 font-mono">{lead.phone}</td>
                    <td className="px-2 py-2">{lead.lead_status?.label || '—'}</td>
                    <td className="px-2 py-2">
                      {lead.assigned_user?.name ||
                        lead.assigned_user?.email ||
                        lead.conversation_status ||
                        '—'}
                    </td>
                    <td className="px-2 py-2">{formatDateTime(lead.first_message_at)}</td>
                    <td className="px-2 py-2">
                      {lead.conversation_id ? (
                        <Link
                          to={`/conversations/${lead.conversation_id}`}
                          className="contact-row-action-btn"
                          title="Abrir chat"
                          aria-label="Abrir chat"
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
                        </Link>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
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
