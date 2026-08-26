import { Link, useSearchParams } from 'react-router-dom'
import { type FormEvent, useEffect, useState } from 'react'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { notify } from '@/shared/notify'
import {
  channelLabel,
  type ContactOriginSummary,
  originPrimaryFields,
  originSecondaryFields,
} from './originDisplay'
import { LeadOpenChatButton } from './LeadOpenChatButton'

type ChannelSummary = {
  channel: string
  count: number
  last_seen_at: string | null
}

const CHANNEL_META: Record<
  string,
  { title: string; blurb: string; to: string; enabled: boolean }
> = {
  meta_lead_form: {
    title: 'Instant Forms',
    blurb: 'Formularios Lead Ads de Facebook / Instagram',
    to: '/leads/meta-forms',
    enabled: true,
  },
  meta_ctwa: {
    title: 'Click-to-WhatsApp',
    blurb: 'Anuncios que abren un chat de WhatsApp',
    to: '/leads/meta-ctwa',
    enabled: true,
  },
  widget: {
    title: 'Widget web',
    blurb: 'Formularios embebidos (MALI ONE)',
    to: '/leads?channel=widget',
    enabled: true,
  },
  tiktok: {
    title: 'TikTok',
    blurb: 'Próximamente',
    to: '/leads',
    enabled: false,
  },
}

const CHANNEL_FILTER_OPTIONS = [
  { value: '', label: 'Todos' },
  { value: 'widget', label: 'Widget web' },
  { value: 'meta_lead_form', label: 'Instant Forms' },
  { value: 'meta_ctwa', label: 'Click-to-WhatsApp' },
  { value: 'organic_wa', label: 'WhatsApp orgánico' },
  { value: 'manual', label: 'Manual' },
  { value: 'import', label: 'Import' },
  { value: 'other', label: 'Otros' },
] as const

export function LeadsHubPage() {
  const [rows, setRows] = useState<ChannelSummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void apiClient.get<ChannelSummary[]>('/api/leads/summary').then((r) => {
      setLoading(false)
      if (!r.ok) {
        notify.error(r.error)
        return
      }
      setRows(r.data)
    })
  }, [])

  const byChannel = Object.fromEntries(rows.map((r) => [r.channel, r]))

  const cards = Object.entries(CHANNEL_META).map(([channel, meta]) => {
    const stats = byChannel[channel]
    return { channel, meta, stats }
  })

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-2xl font-semibold">Leads</h1>
        <p className="mt-1 text-sm text-muted">
          Prospectos por canal de captación. Lista unificada abajo; detalle por canal en cada tarjeta.
        </p>
      </div>

      {loading ? (
        <p className="text-muted">Cargando…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ channel, meta, stats }) => (
            <div
              key={channel}
              className="rounded-xl border border-line bg-surface-strong p-4"
            >
              <h2 className="font-medium">{meta.title}</h2>
              <p className="mt-1 text-sm text-muted">{meta.blurb}</p>
              <p className="mt-3 text-sm">
                <span className="text-muted">Eventos:</span>{' '}
                {stats?.count ?? 0}
                {stats?.last_seen_at ? (
                  <>
                    {' '}
                    · último {formatDateTime(stats.last_seen_at)}
                  </>
                ) : null}
              </p>
              {meta.enabled ? (
                <Link
                  to={meta.to}
                  className="mt-3 inline-block text-sm text-accent hover:underline"
                >
                  {channel === 'widget' ? 'Ver listado →' : 'Abrir →'}
                </Link>
              ) : (
                <p className="mt-3 text-sm text-muted">No disponible aún</p>
              )}
            </div>
          ))}
        </div>
      )}

      <LeadsUnifiedList />
      <LeadStatusesAdmin />
    </div>
  )
}

type OriginRow = ContactOriginSummary & {
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

function LeadsUnifiedList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const channel = (searchParams.get('channel') || '').trim()
  const channelFilterLabel =
    CHANNEL_FILTER_OPTIONS.find((o) => o.value === channel)?.label || channel

  const [items, setItems] = useState<OriginRow[]>([])

  useEffect(() => {
    const qs = new URLSearchParams({ limit: '40' })
    if (channel) qs.set('channel', channel)
    void apiClient
      .get<{ items: OriginRow[] }>(`/api/leads/origins?${qs}`)
      .then((r) => {
        if (r.ok) setItems(r.data.items)
      })
  }, [channel])

  function onChannelChange(value: string) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('channel', value)
    else next.delete('channel')
    setSearchParams(next, { replace: true })
  }

  return (
    <section className="rounded-xl border border-line bg-surface-strong p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium">
          {channel
            ? `Recientes · ${channelFilterLabel}`
            : 'Recientes (todos los canales)'}
        </h2>
        <label className="text-sm">
          <span className="sr-only">Canal</span>
          <select
            className="rounded-lg border border-line bg-bg px-2 py-1.5"
            value={channel}
            onChange={(e) => onChannelChange(e.target.value)}
          >
            {CHANNEL_FILTER_OPTIONS.map((o) => (
              <option key={o.value || 'all'} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {items.length === 0 ? (
        <p className="text-sm text-muted">
          {channel
            ? 'No hay orígenes para este canal.'
            : 'Aún no hay orígenes registrados.'}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th className="px-2 py-2">Canal</th>
                <th className="px-2 py-2">Contacto</th>
                <th className="px-2 py-2">Curso</th>
                <th className="px-2 py-2">Fuente</th>
                <th className="px-2 py-2">Estado</th>
                <th className="px-2 py-2">Chat</th>
                <th className="px-2 py-2">Último</th>
              </tr>
            </thead>
            <tbody>
              {items.map((o) => {
                const primary = originPrimaryFields(o)
                const secondary = originSecondaryFields(o)
                return (
                  <tr key={o.id} className="border-b border-line last:border-0">
                    <td className="px-2 py-2">{channelLabel(o.channel)}</td>
                    <td className="px-2 py-2">
                      {o.contacts ? (
                        <Link
                          to={`/contacts/${o.contacts.id}`}
                          className="text-accent hover:underline"
                        >
                          {o.contacts.name}
                          {o.contacts.phone ? ` · ${o.contacts.phone}` : ''}
                          {o.contacts.email ? ` · ${o.contacts.email}` : ''}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {primary.curso ? (
                        <div>
                          <div>{primary.curso}</div>
                          {primary.cursoUrl ? (
                            <a
                              href={primary.cursoUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-accent hover:underline"
                            >
                              Ver ficha
                            </a>
                          ) : null}
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-2 py-2">
                      {primary.fuente || '—'}
                      {primary.programa ? (
                        <div className="text-xs text-muted">
                          {primary.programa}
                        </div>
                      ) : null}
                      {secondary.source ? (
                        <div className="text-xs text-muted">{secondary.source}</div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2">
                      {o.contacts?.lead_status?.label || '—'}
                    </td>
                    <td className="px-2 py-2">
                      <LeadOpenChatButton
                        contactId={o.contacts?.id}
                        conversationId={o.chat_conversation_id}
                        cameWithInbound={o.came_with_inbound}
                      />
                    </td>
                    <td className="px-2 py-2">
                      {formatDateTime(o.last_seen_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

type StatusRow = {
  id: number
  slug: string
  label: string
  sort_order: number
  is_default: boolean
  is_terminal: boolean
  active: boolean
}

function LeadStatusesAdmin() {
  const [statuses, setStatuses] = useState<StatusRow[]>([])
  const [label, setLabel] = useState('')
  const [slug, setSlug] = useState('')

  async function reload() {
    const r = await apiClient.get<StatusRow[]>('/api/leads/statuses')
    if (r.ok) setStatuses(r.data)
  }

  useEffect(() => {
    void reload()
  }, [])

  async function onCreate(e: FormEvent) {
    e.preventDefault()
    const r = await apiClient.post<StatusRow>('/api/leads/statuses', {
      slug,
      label,
    })
    if (!r.ok) {
      notify.error(r.error)
      return
    }
    setLabel('')
    setSlug('')
    notify.success('Estado creado')
    void reload()
  }

  return (
    <section className="rounded-xl border border-line bg-surface-strong p-4">
      <h2 className="mb-3 font-medium">Estados de lead</h2>
      <ul className="mb-4 space-y-1 text-sm">
        {statuses.map((s) => (
          <li key={s.id}>
            {s.label}{' '}
            <span className="text-muted">
              ({s.slug}
              {s.is_default ? ' · default' : ''}
              {!s.active ? ' · inactivo' : ''})
            </span>
          </li>
        ))}
      </ul>
      <form onSubmit={onCreate} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="text-muted">Slug</span>
          <input
            className="mt-1 block rounded-lg border border-line bg-bg px-3 py-2"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
          />
        </label>
        <label className="text-sm">
          <span className="text-muted">Etiqueta</span>
          <input
            className="mt-1 block rounded-lg border border-line bg-bg px-3 py-2"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
          />
        </label>
        <button
          type="submit"
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white"
        >
          Añadir
        </button>
      </form>
    </section>
  )
}
