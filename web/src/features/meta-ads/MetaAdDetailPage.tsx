import { type FormEvent, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
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
  conversation_id: number | null
}

type DetailPayload = {
  ad: MetaAdDetail
  leads: MetaAdLead[]
}

export function MetaAdDetailPage() {
  const { id } = useParams()
  const [payload, setPayload] = useState<DetailPayload | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!id) return
    apiClient.get<DetailPayload>(`/api/meta-ads/${id}`).then((result) => {
      if (!result.ok) {
        setError(result.error)
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
    setSaveMsg('')
    const result = await apiClient.patch<MetaAdDetail>(`/api/meta-ads/${id}`, {
      display_name: displayName,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setPayload((prev) =>
      prev ? { ...prev, ad: { ...prev.ad, ...result.data } } : prev,
    )
    setSaveMsg('Nombre guardado.')
  }

  if (error) {
    return <p className="text-bad">{error}</p>
  }

  if (!payload) {
    return <p className="text-muted">Cargando anuncio…</p>
  }

  const { ad, leads } = payload

  return (
    <div className="space-y-6">
      <div>
        <Link to="/anuncios" className="inbox-back-mobile">
          ← Anuncios
        </Link>
        <Link to="/anuncios" className="text-sm text-accent hover:underline max-md:hidden">
          ← Anuncios
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{ad.display_label}</h1>
        <p className="font-mono text-sm text-muted">
          ID Meta: {ad.meta_source_id} · {ad.platform_label}
        </p>
      </div>

      {saveMsg ? <p className="text-sm text-accent">{saveMsg}</p> : null}

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
                  <th className="px-2 py-2 font-medium">Primer mensaje</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead) => (
                  <tr key={lead.phone} className="border-b border-line last:border-0">
                    <td className="px-2 py-2">{lead.contact_name || '—'}</td>
                    <td className="px-2 py-2 font-mono">{lead.phone}</td>
                    <td className="px-2 py-2">{formatDateTime(lead.first_message_at)}</td>
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
