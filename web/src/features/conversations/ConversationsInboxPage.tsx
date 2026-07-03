import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { formatContactName } from '../contacts/contactName'
import { segmentToneClass } from '../segments/segmentColors'

const SEGMENT_NONE = '__none__'
const INBOX_POLL_MS = 8000

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < 120
}

type SegmentOption = {
  slug: string
  label: string
  color_key: string
}

type InboxListItem = {
  id: number
  phone: string
  last_message_at: string | null
  inbox_unread: boolean
  conversation_status: string | null
  contact_name: string
  contact_lead_score: number | null
  contact_segment_slugs: string[]
  preview: string
  conversation_tags: string[]
  is_virtual: boolean
  contact_id: number | null
}

type InboxListResult = {
  items: InboxListItem[]
  unread_count: number
  ai_area_enabled: boolean
  segments: SegmentOption[]
  filters: {
    q: string
    chat: 'all' | 'unread' | 'bot' | 'human'
    segment_slugs: string[]
    include_none: boolean
  }
}

type InboxMessage = {
  id: number
  direction: string
  body_text: string | null
  message_type: string
  created_at: string
  is_ai: boolean
}

type InboxDetail = {
  conversation: {
    id: number
    phone: string
    status: string
    last_message_at: string | null
    last_user_message_at?: string | null
    inbox_unread: boolean
    contact_id: number | null
  }
  contact: {
    name: string | null
    phone: string
    lead_score: number | null
    segment_slugs: string[]
  } | null
  meta_ad: {
    display_name: string | null
    headline: string | null
    source_url: string | null
  } | null
  messages: InboxMessage[]
  tags: string[]
  can_reply: boolean
  reply_blocked_reason: '24h' | 'bot_mode' | null
  user_service_window_open: boolean
  ai_area_enabled: boolean
}

type InboxConversationUpdates = {
  messages: InboxMessage[]
  conversation: {
    last_message_at: string | null
    last_user_message_at: string | null
    status: string
    inbox_unread: boolean
  }
  can_reply: boolean
  reply_blocked_reason: '24h' | 'bot_mode' | null
  user_service_window_open: boolean
}

function inboxApiQuery(searchParams: URLSearchParams): string {
  const qs = new URLSearchParams()
  const q = searchParams.get('q')
  if (q) qs.set('q', q)
  const chat = searchParams.get('chat')
  if (chat && chat !== 'all') qs.set('chat', chat)
  searchParams.getAll('segment').forEach((slug) => qs.append('segment', slug))
  const value = qs.toString()
  return value ? `?${value}` : ''
}

function inboxInitials(contactName: string, phone: string): string {
  const name = contactName.trim()
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase().slice(0, 2)
    }
    return name.slice(0, 2).toUpperCase()
  }
  const digits = phone.replace(/\D/g, '')
  return digits.slice(-2) || '?'
}

function messageBodyLabel(message: InboxMessage): string {
  const type = message.message_type.toLowerCase()
  if (type === 'image') return 'Imagen'
  if (type === 'video') return 'Video'
  if (type === 'audio') return 'Audio'
  if (type === 'document') return 'Documento'
  if (type === 'sticker') return 'Sticker'
  return message.body_text?.trim() || '(sin texto)'
}

function listPreviewText(preview: string): string {
  return preview.trim() || 'Sin mensajes'
}

function segmentLabel(slug: string, segments: SegmentOption[]): string {
  return segments.find((s) => s.slug === slug)?.label ?? slug
}

function replyBlockedText(reason: InboxDetail['reply_blocked_reason']): string {
  if (reason === '24h') {
    return 'La ventana de 24 h para responder al cliente está cerrada. Solo puedes enviar plantillas aprobadas (próximamente en este módulo).'
  }
  if (reason === 'bot_mode') {
    return 'La conversación está en modo Bot. Cambia a modo Asesor para responder manualmente (próximamente).'
  }
  return ''
}

export function ConversationsInboxPage() {
  const { id: idParam } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const [list, setList] = useState<InboxListResult | null>(null)
  const [detail, setDetail] = useState<InboxDetail | null>(null)
  const [error, setError] = useState('')
  const [replyError, setReplyError] = useState('')
  const [replyText, setReplyText] = useState('')
  const [replyFile, setReplyFile] = useState<File | null>(null)
  const [sendingReply, setSendingReply] = useState(false)
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '')
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null)
  const lastMessageIdRef = useRef(0)
  const messagesPaneRef = useRef<HTMLDivElement | null>(null)
  const sendingReplyRef = useRef(false)

  const selectedId = idParam ? Number(idParam) : null
  const querySuffix = useMemo(() => inboxApiQuery(searchParams), [searchParams])
  const chatFilter = (searchParams.get('chat') || 'all') as InboxListResult['filters']['chat']
  const selectedSegments = searchParams.getAll('segment')

  const loadList = useCallback((opts?: { silent?: boolean }) => {
    return apiClient
      .get<InboxListResult>(`/api/conversations${querySuffix}`)
      .then((result) => {
        if (!result.ok) {
          if (!opts?.silent) setError(result.error)
          return
        }
        setList(result.data)
        setLastSyncedAt(new Date())
      })
  }, [querySuffix])

  const loadDetail = useCallback(
    (conversationId: number) => {
      setLoadingDetail(true)
      setError('')
      return apiClient
        .get<InboxDetail>(`/api/conversations/${conversationId}`)
        .then((result) => {
          setLoadingDetail(false)
          if (!result.ok) {
            setError(result.error)
            setDetail(null)
            return
          }
          setDetail(result.data)
          void loadList()
        })
    },
    [loadList],
  )

  const pollConversationUpdates = useCallback(
    async (conversationId: number) => {
      const afterId = lastMessageIdRef.current
      const result = await apiClient.get<InboxConversationUpdates>(
        `/api/conversations/${conversationId}/updates?after_message_id=${afterId}`,
      )
      if (!result.ok) return

      const pane = messagesPaneRef.current
      const shouldScroll = pane ? isNearBottom(pane) : true
      const incoming = result.data.messages

      setDetail((prev) => {
        if (!prev) return prev
        const known = new Set(prev.messages.map((message) => message.id))
        const merged = [...prev.messages]
        for (const message of incoming) {
          if (!known.has(message.id)) merged.push(message)
        }
        merged.sort((a, b) => a.id - b.id)
        return {
          ...prev,
          messages: merged,
          conversation: {
            ...prev.conversation,
            status: result.data.conversation.status,
            last_message_at: result.data.conversation.last_message_at,
            last_user_message_at: result.data.conversation.last_user_message_at,
            inbox_unread: result.data.conversation.inbox_unread,
          },
          can_reply: result.data.can_reply,
          reply_blocked_reason: result.data.reply_blocked_reason,
          user_service_window_open: result.data.user_service_window_open,
        }
      })

      if (incoming.length > 0) {
        lastMessageIdRef.current = Math.max(
          afterId,
          ...incoming.map((message) => message.id),
        )
        if (shouldScroll && pane) {
          requestAnimationFrame(() => {
            pane.scrollTop = pane.scrollHeight
          })
        }
      }
      setLastSyncedAt(new Date())
    },
    [],
  )

  useEffect(() => {
    if (!detail?.messages.length) {
      lastMessageIdRef.current = 0
      return
    }
    lastMessageIdRef.current = Math.max(...detail.messages.map((message) => message.id))
  }, [detail?.conversation.id, detail?.messages])

  useEffect(() => {
    sendingReplyRef.current = sendingReply
  }, [sendingReply])

  useEffect(() => {
    function tick() {
      if (document.visibilityState === 'hidden') return
      void loadList({ silent: true })
      if (
        selectedId != null &&
        selectedId > 0 &&
        !sendingReplyRef.current
      ) {
        void pollConversationUpdates(selectedId)
      }
    }

    const timer = window.setInterval(tick, INBOX_POLL_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loadList, pollConversationUpdates, selectedId])

  useEffect(() => {
    setError('')
    void loadList()
  }, [loadList])

  useEffect(() => {
    if (selectedId == null || Number.isNaN(selectedId)) {
      setDetail(null)
      return
    }

    if (selectedId < 0) {
      const contactId = -selectedId
      setLoadingDetail(true)
      apiClient
        .post<{ id: number }>(`/api/conversations/from-contact/${contactId}`, {})
        .then((result) => {
          if (!result.ok) {
            setError(result.error)
            setLoadingDetail(false)
            return
          }
          navigate(`/conversations/${result.data.id}${querySuffix}`, { replace: true })
        })
      return
    }

    setLoadingDetail(true)
    setError('')
    void loadDetail(selectedId)
  }, [selectedId, navigate, querySuffix, loadDetail])

  useEffect(() => {
    setReplyText('')
    setReplyFile(null)
    setReplyError('')
  }, [selectedId])

  function setChatFilter(chat: InboxListResult['filters']['chat']) {
    const next = new URLSearchParams(searchParams)
    if (chat === 'all') next.delete('chat')
    else next.set('chat', chat)
    setSearchParams(next)
  }

  function toggleSegment(slug: string) {
    const next = new URLSearchParams(searchParams)
    const current = next.getAll('segment')
    if (current.includes(slug)) {
      next.delete('segment')
      current.filter((s) => s !== slug).forEach((s) => next.append('segment', s))
    } else {
      next.append('segment', slug)
    }
    setSearchParams(next)
  }

  function onSearchSubmit(event: FormEvent) {
    event.preventDefault()
    const next = new URLSearchParams(searchParams)
    const q = searchInput.trim()
    if (q) next.set('q', q)
    else next.delete('q')
    setSearchParams(next)
  }

  async function onSelectItem(item: InboxListItem) {
    if (item.is_virtual && item.contact_id) {
      setLoadingDetail(true)
      const result = await apiClient.post<{ id: number }>(
        `/api/conversations/from-contact/${item.contact_id}`,
        {},
      )
      setLoadingDetail(false)
      if (!result.ok) {
        setError(result.error)
        return
      }
      navigate(`/conversations/${result.data.id}${querySuffix}`)
      return
    }
    navigate(`/conversations/${item.id}${querySuffix}`)
  }

  async function onModeChange(status: 'bot' | 'human') {
    if (!selectedId || selectedId <= 0) return
    setReplyError('')
    const result = await apiClient.patch<{ status: 'bot' | 'human' }>(
      `/api/conversations/${selectedId}/mode`,
      { status },
    )
    if (!result.ok) {
      setReplyError(result.error)
      return
    }
    void loadDetail(selectedId)
  }

  async function onSendReply(event: FormEvent) {
    event.preventDefault()
    if (!selectedId || selectedId <= 0 || !detail?.can_reply) return
    const text = replyText.trim()
    if (!text && !replyFile) {
      setReplyError('Escribe un mensaje o adjunta un archivo')
      return
    }
    setSendingReply(true)
    setReplyError('')
    const result = replyFile
      ? await (() => {
          const formData = new FormData()
          if (text) formData.append('message', text)
          formData.append('file', replyFile)
          return apiClient.postFormData<{ messages: InboxMessage[] }>(
            `/api/conversations/${selectedId}/reply`,
            formData,
          )
        })()
      : await apiClient.post<{ messages: InboxMessage[] }>(
          `/api/conversations/${selectedId}/reply`,
          { message: text },
        )
    setSendingReply(false)
    if (!result.ok) {
      setReplyError(result.error)
      return
    }
    setReplyText('')
    setReplyFile(null)
    void loadDetail(selectedId)
  }

  const segments = list?.segments ?? []
  const displayName = (item: InboxListItem) =>
    formatContactName(item.contact_name, null, item.phone)

  if (error && !list) {
    return <p className="text-bad">{error}</p>
  }

  return (
    <div className="-mx-4 flex min-h-[calc(100vh-10rem)] border-y border-line">
      <aside
        className={`flex w-full max-w-md flex-col border-r border-line bg-surface-strong/40 md:w-[22rem] md:shrink-0 ${
          selectedId != null ? 'hidden md:flex' : 'flex'
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h1 className="text-lg font-semibold">Chats</h1>
          <div className="flex items-center gap-2">
            {lastSyncedAt ? (
              <span className="hidden text-[10px] text-muted sm:inline" title="Última sincronización">
                {formatDateTime(lastSyncedAt)}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void loadList()}
              className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-accent-soft"
            >
              Actualizar
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
          {(
            [
              { key: 'all', label: 'Todos' },
              { key: 'unread', label: `No leídos (${list?.unread_count ?? 0})` },
            ] as const
          ).map((pill) => (
            <button
              key={pill.key}
              type="button"
              onClick={() => setChatFilter(pill.key)}
              className={`rounded-full px-2.5 py-1 text-xs ${
                chatFilter === pill.key
                  ? 'bg-accent-soft font-medium text-accent'
                  : 'text-muted hover:bg-accent-soft'
              }`}
            >
              {pill.label}
            </button>
          ))}
          {list?.ai_area_enabled ? (
            <>
              <button
                type="button"
                onClick={() => setChatFilter('bot')}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  chatFilter === 'bot'
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-muted hover:bg-accent-soft'
                }`}
              >
                Bot
              </button>
              <button
                type="button"
                onClick={() => setChatFilter('human')}
                className={`rounded-full px-2.5 py-1 text-xs ${
                  chatFilter === 'human'
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-muted hover:bg-accent-soft'
                }`}
              >
                Asesor
              </button>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-1 border-b border-line px-3 py-2">
          <button
            type="button"
            onClick={() => toggleSegment(SEGMENT_NONE)}
            className={`rounded-full px-2 py-0.5 text-xs ${
              selectedSegments.includes(SEGMENT_NONE)
                ? segmentToneClass('slate')
                : 'border border-line text-muted'
            }`}
          >
            Sin segmento
          </button>
          {segments.map((segment) => (
            <button
              key={segment.slug}
              type="button"
              onClick={() => toggleSegment(segment.slug)}
              className={`rounded-full px-2 py-0.5 text-xs ${
                selectedSegments.includes(segment.slug)
                  ? segmentToneClass(segment.color_key)
                  : 'border border-line text-muted'
              }`}
            >
              {segment.label}
            </button>
          ))}
        </div>

        <form onSubmit={onSearchSubmit} className="border-b border-line px-3 py-2">
          <div className="flex gap-2">
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar en chats…"
              className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
            />
            <button
              type="submit"
              className="rounded-lg border border-line px-2 py-1.5 text-sm hover:bg-accent-soft"
            >
              Buscar
            </button>
          </div>
        </form>

        <ul className="flex-1 overflow-y-auto">
          {!list ? (
            <li className="px-4 py-6 text-sm text-muted">Cargando…</li>
          ) : list.items.length === 0 ? (
            <li className="px-4 py-6 text-sm text-muted">No hay conversaciones.</li>
          ) : (
            list.items.map((item) => {
              const active = selectedId === item.id
              const name = displayName(item)
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void onSelectItem(item)}
                    className={`flex w-full gap-3 border-b border-line px-3 py-3 text-left hover:bg-accent-soft/50 ${
                      active ? 'bg-accent-soft/60' : ''
                    }`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-medium text-accent">
                      {inboxInitials(item.contact_name, item.phone)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate font-medium">{name}</span>
                        {item.inbox_unread ? (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-label="No leído" />
                        ) : null}
                      </span>
                      <span className="line-clamp-1 text-xs text-muted">
                        {listPreviewText(item.preview)}
                      </span>
                      {item.contact_segment_slugs.length > 0 ? (
                        <span className="mt-1 flex flex-wrap gap-1">
                          {item.contact_segment_slugs.slice(0, 2).map((slug) => (
                            <span
                              key={slug}
                              className={`rounded px-1 text-[10px] ${segmentToneClass(
                                segments.find((s) => s.slug === slug)?.color_key,
                              )}`}
                            >
                              {segmentLabel(slug, segments)}
                            </span>
                          ))}
                        </span>
                      ) : null}
                    </span>
                    {item.last_message_at ? (
                      <span className="shrink-0 text-[10px] text-muted">
                        {formatDateTime(item.last_message_at)}
                      </span>
                    ) : null}
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </aside>

      <section
        className={`min-w-0 flex-1 flex-col bg-surface ${
          selectedId != null ? 'flex' : 'hidden md:flex'
        }`}
      >
        {selectedId == null ? (
          <div className="flex flex-1 items-center justify-center p-8 text-muted">
            Selecciona una conversación
          </div>
        ) : loadingDetail && !detail ? (
          <div className="flex flex-1 items-center justify-center p-8 text-muted">
            Cargando chat…
          </div>
        ) : error && !detail ? (
          <div className="flex flex-1 items-center justify-center p-8 text-bad">{error}</div>
        ) : detail ? (
          <>
            <header className="flex items-start gap-3 border-b border-line px-4 py-3">
              <button
                type="button"
                className="mt-1 rounded-lg border border-line px-2 py-1 text-xs md:hidden"
                onClick={() => navigate(`/conversations${querySuffix}`)}
              >
                ← Lista
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="truncate text-lg font-semibold">
                  {formatContactName(detail.contact?.name, null, detail.conversation.phone)}
                </h2>
                <p className="text-sm text-muted">{detail.conversation.phone}</p>
                {detail.contact?.segment_slugs?.length ? (
                  <p className="mt-1 flex flex-wrap gap-1">
                    {detail.contact.segment_slugs.map((slug) => (
                      <span
                        key={slug}
                        className={`rounded px-1.5 py-0.5 text-xs ${segmentToneClass(
                          segments.find((s) => s.slug === slug)?.color_key,
                        )}`}
                      >
                        {segmentLabel(slug, segments)}
                      </span>
                    ))}
                  </p>
                ) : null}
                {detail.meta_ad?.display_name ? (
                  <p className="muted mt-1 text-xs">
                    Anuncio: {detail.meta_ad.display_name}
                    {detail.meta_ad.source_url ? (
                      <>
                        {' '}
                        ·{' '}
                        <a
                          href={detail.meta_ad.source_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-accent underline"
                        >
                          Ver
                        </a>
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
              {detail.ai_area_enabled ? (
                <div className="flex shrink-0 flex-col gap-1">
                  <span className="text-[10px] uppercase tracking-wide text-muted">
                    Modo
                  </span>
                  <div className="flex gap-1">
                    {(['human', 'bot'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => void onModeChange(mode)}
                        className={`rounded-full px-2 py-0.5 text-xs capitalize ${
                          detail.conversation.status === mode
                            ? 'bg-accent-soft font-medium text-accent'
                            : 'border border-line text-muted hover:bg-accent-soft'
                        }`}
                      >
                        {mode === 'human' ? 'Asesor' : 'Bot'}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </header>

            <div
              ref={messagesPaneRef}
              className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
            >
              {detail.messages.length === 0 ? (
                <p className="text-center text-sm text-muted">Sin mensajes aún.</p>
              ) : (
                detail.messages.map((message) => {
                  const outbound = message.direction === 'outbound'
                  return (
                    <div
                      key={message.id}
                      className={`flex ${outbound ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${
                          outbound
                            ? 'bg-accent-soft text-ink'
                            : 'border border-line bg-surface-strong'
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">
                          {messageBodyLabel(message)}
                        </p>
                        <p className="mt-1 text-[10px] text-muted">
                          {formatDateTime(message.created_at)}
                          {message.is_ai ? ' · IA' : ''}
                        </p>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <footer className="border-t border-line px-4 py-3">
              {detail.can_reply ? (
                <form onSubmit={(e) => void onSendReply(e)} className="space-y-2">
                  <textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    rows={3}
                    placeholder="Escribe un mensaje…"
                    className="w-full resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft">
                      Adjuntar
                      <input
                        type="file"
                        className="sr-only"
                        accept="image/jpeg,image/png,video/mp4,audio/*,application/pdf"
                        onChange={(e) =>
                          setReplyFile(e.target.files?.[0] ?? null)
                        }
                      />
                    </label>
                    {replyFile ? (
                      <span className="text-xs text-muted">
                        {replyFile.name}{' '}
                        <button
                          type="button"
                          className="text-accent underline"
                          onClick={() => setReplyFile(null)}
                        >
                          Quitar
                        </button>
                      </span>
                    ) : null}
                    <button
                      type="submit"
                      disabled={sendingReply}
                      className="ml-auto rounded-lg bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-60"
                    >
                      {sendingReply ? 'Enviando…' : 'Enviar'}
                    </button>
                  </div>
                  {replyError ? (
                    <p className="text-sm text-bad">{replyError}</p>
                  ) : null}
                </form>
              ) : (
                <p className="muted text-sm">{replyBlockedText(detail.reply_blocked_reason)}</p>
              )}
              {detail.contact?.lead_score ? (
                <p className="muted mt-2 text-xs">
                  Lead score: {detail.contact.lead_score}/5 ·{' '}
                  <Link to={`/contacts/${detail.conversation.contact_id}`} className="text-accent">
                    Ver contacto
                  </Link>
                </p>
              ) : detail.conversation.contact_id ? (
                <p className="muted mt-2 text-xs">
                  <Link to={`/contacts/${detail.conversation.contact_id}`} className="text-accent">
                    Ver contacto
                  </Link>
                </p>
              ) : null}
            </footer>
          </>
        ) : null}
      </section>
    </div>
  )
}
