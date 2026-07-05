import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import {
  WaMainPane,
  WaMainHeader,
  WaMainFooter,
} from '@/shared/ui/shell/WaMainPane'
import { ChatEmptyIcon, WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { formatContactName } from '../contacts/contactName'

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
  has_downloadable_media: boolean
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
    return <p className="text-bad p-4">{error}</p>
  }

  const filterPills = (
    <>
      <div className="inbox-chat-filter-pills inbox-chat-filter-pills--row" aria-label="Filtrar lista">
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
            className={`inbox-chat-pill ${chatFilter === pill.key ? 'is-active' : ''}`}
          >
            {pill.label}
          </button>
        ))}
        {list?.ai_area_enabled ? (
          <>
            <button
              type="button"
              onClick={() => setChatFilter('bot')}
              className={`inbox-chat-pill ${chatFilter === 'bot' ? 'is-active' : ''}`}
            >
              Bot
            </button>
            <button
              type="button"
              onClick={() => setChatFilter('human')}
              className={`inbox-chat-pill ${chatFilter === 'human' ? 'is-active' : ''}`}
            >
              Asesor
            </button>
          </>
        ) : null}
      </div>
      <div className="inbox-chat-filter-pills">
        <button
          type="button"
          onClick={() => toggleSegment(SEGMENT_NONE)}
          className={`inbox-chat-pill ${selectedSegments.includes(SEGMENT_NONE) ? 'is-active' : ''}`}
        >
          Sin segmento
        </button>
        {segments.map((segment) => (
          <button
            key={segment.slug}
            type="button"
            onClick={() => toggleSegment(segment.slug)}
            className={`inbox-chat-pill ${selectedSegments.includes(segment.slug) ? 'is-active' : ''}`}
          >
            {segment.label}
          </button>
        ))}
      </div>
      <form onSubmit={onSearchSubmit} className="inbox-filters">
        <div className="inbox-search-row">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar en chats…"
            className="inbox-search-input"
          />
          <button type="submit" className="small-btn">
            Buscar
          </button>
        </div>
      </form>
    </>
  )

  return (
    <WaPageContents>
      <WaSidebar
        title="Chats"
        onRefresh={() => void loadList()}
        refreshTitle="Actualizar chats"
        filters={filterPills}
        actions={
          lastSyncedAt ? (
            <span className="hidden text-[10px] text-muted sm:inline" title="Última sincronización">
              {formatDateTime(lastSyncedAt)}
            </span>
          ) : null
        }
      >
        <ul className="inbox-chat-list">
          {!list ? (
            <li className="inbox-empty-list">Cargando…</li>
          ) : list.items.length === 0 ? (
            <li className="inbox-empty-list">No hay conversaciones.</li>
          ) : (
            list.items.map((item) => {
              const active = selectedId === item.id
              const name = displayName(item)
              return (
                <li key={item.id} className={`inbox-chat-item ${active ? 'is-active' : ''}`}>
                  <button
                    type="button"
                    onClick={() => void onSelectItem(item)}
                    className="inbox-chat-item-btn"
                  >
                    <span className="inbox-chat-avatar">
                      {inboxInitials(item.contact_name, item.phone)}
                    </span>
                    <span className="inbox-chat-link-main">
                      <span className="inbox-chat-row-top">
                        <span className="inbox-chat-title">{name}</span>
                        {item.inbox_unread ? (
                          <span className="inbox-unread-dot" aria-label="No leído" />
                        ) : null}
                        {item.last_message_at ? (
                          <span className="inbox-chat-time">
                            {formatDateTime(item.last_message_at)}
                          </span>
                        ) : null}
                      </span>
                      <span className="inbox-chat-preview">{listPreviewText(item.preview)}</span>
                    </span>
                  </button>
                </li>
              )
            })
          )}
        </ul>
      </WaSidebar>

      <WaMainPane>
        {selectedId == null ? (
          <WaEmptyPane
            icon={<ChatEmptyIcon />}
            heading="Conversaciones"
            text="Selecciona un chat para ver los mensajes. Las respuestas del cliente se guardan como mensajes entrantes."
          />
        ) : loadingDetail && !detail ? (
          <WaEmptyPane heading="Cargando chat…" />
        ) : error && !detail ? (
          <WaEmptyPane heading={error} />
        ) : detail ? (
          <>
            <WaMainHeader>
              <button
                type="button"
                className="inbox-back-mobile"
                onClick={() => navigate(`/conversations${querySuffix}`)}
              >
                ← Lista
              </button>
              <div className="min-w-0 flex-1">
                <h2 className="inbox-chat-heading">
                  {formatContactName(detail.contact?.name, null, detail.conversation.phone)}
                </h2>
                <p className="inbox-chat-sub">{detail.conversation.phone}</p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <button
                  type="button"
                  className="small-btn"
                  onClick={() =>
                    void apiClient.download(`/api/conversations/${selectedId}/export`)
                  }
                >
                  Exportar
                </button>
                {detail.ai_area_enabled ? (
                  <div className="flex gap-1">
                    {(['human', 'bot'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => void onModeChange(mode)}
                        className={`inbox-chat-pill ${detail.conversation.status === mode ? 'is-active' : ''}`}
                      >
                        {mode === 'human' ? 'Asesor' : 'Bot'}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </WaMainHeader>

            <div className="inbox-chat-body">
              <div ref={messagesPaneRef} className="chat-thread--inbox">
                {detail.messages.length === 0 ? (
                  <p className="text-center text-sm text-muted">Sin mensajes aún.</p>
                ) : (
                  detail.messages.map((message) => {
                    const outbound = message.direction === 'outbound'
                    return (
                      <div
                        key={message.id}
                        className={`chat-bubble ${outbound ? 'chat-bubble--out' : 'chat-bubble--in'} ${message.is_ai ? 'chat-bubble--ai' : ''}`}
                      >
                        <p className="chat-bubble__text">{messageBodyLabel(message)}</p>
                        <p className="chat-bubble__meta">
                          {formatDateTime(message.created_at)}
                          {message.is_ai ? ' · IA' : ''}
                        </p>
                      </div>
                    )
                  })
                )}
              </div>
            </div>

            <WaMainFooter>
              {detail.can_reply ? (
                <form onSubmit={(e) => void onSendReply(e)} className="inbox-compose-stack">
                  <div className="inbox-compose-bar">
                    <label className="inbox-compose-file-btn">
                      Adjuntar
                      <input
                        type="file"
                        accept="image/jpeg,image/png,video/mp4,audio/*,application/pdf"
                        onChange={(e) => setReplyFile(e.target.files?.[0] ?? null)}
                      />
                    </label>
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      rows={2}
                      placeholder="Escribe un mensaje…"
                      className="inbox-compose-textarea inbox-compose-grow"
                    />
                    <button type="submit" disabled={sendingReply} className="inbox-compose-send">
                      {sendingReply ? '…' : 'Enviar'}
                    </button>
                  </div>
                  {replyError ? <p className="inbox-compose-hint text-bad">{replyError}</p> : null}
                </form>
              ) : (
                <p className="inbox-compose-hint">{replyBlockedText(detail.reply_blocked_reason)}</p>
              )}
            </WaMainFooter>
          </>
        ) : null}
      </WaMainPane>
    </WaPageContents>
  )
}
