import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatChatListTime } from '../../shared/format'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import {
  WaMainPane,
  WaMainHeader,
  WaMainFooter,
} from '@/shared/ui/shell/WaMainPane'
import { ChatEmptyIcon, WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { Alert, AlertDescription } from '@/shared/ui/shadcn/alert'
import { Badge } from '@/shared/ui/shadcn/badge'
import { Button } from '@/shared/ui/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/shadcn/dropdown-menu'
import { formatContactName } from '../contacts/contactName'
import { SegmentFilterChips } from '../segments/SegmentFilterChips'
import { SegmentBadge } from '../segments/SegmentBadge'
import { ChatMessageBubble } from './ChatMessageBubble'
import { InboxComposeBar } from './InboxComposeBar'
import { InboxMessageScroller, type InboxMessageScrollerHandle } from './InboxMessageScroller'
const INBOX_POLL_MS = 8000

function segmentLabel(slug: string, segments: SegmentOption[]): string {
  return segments.find((s) => s.slug === slug)?.label ?? slug
}

function segmentColorKey(slug: string, segments: SegmentOption[]): string {
  return segments.find((s) => s.slug === slug)?.color_key ?? 'slate'
}

function LeadStars({ score }: { score: number }) {
  return (
    <span className="inbox-chat-lead-stars" aria-label={`Calificación ${score} de 5`} title="Calificación del lead">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={`inbox-chat-lead-star ${i <= score ? 'is-on' : ''}`}>
          ★
        </span>
      ))}
    </span>
  )
}

function conversationModeBadge(status: string | null) {
  const st = String(status ?? '').toLowerCase()
  if (st === 'bot') {
    return (
      <Badge variant="default" title="Modo Bot">
        Bot
      </Badge>
    )
  }
  if (st === 'human') {
    return (
      <Badge variant="success" title="Modo Asesor">
        Asesor
      </Badge>
    )
  }
  return null
}

function ProfileBlock({
  detail,
  segments,
}: {
  detail: InboxDetail
  segments: SegmentOption[]
}) {
  const contactId = detail.conversation.contact_id
  const heading = formatContactName(
    detail.contact?.name,
    null,
    detail.conversation.phone,
  )
  return (
    <>
      <span className="inbox-chat-avatar inbox-chat-avatar--header" aria-hidden>
        {inboxInitials(detail.contact?.name ?? '', detail.conversation.phone)}
      </span>
      <div className="inbox-chat-header-identity">
        <h1 className="inbox-chat-heading">{heading}</h1>
        <p className="inbox-chat-sub">
          {detail.conversation.phone}
          {contactId ? ' · Perfil' : ''}
        </p>
        {detail.meta_ad ? (
          <p className="inbox-chat-sub muted">
            Anuncio:{' '}
            <Link to={`/anuncios/${detail.meta_ad.id}`}>
              {detail.meta_ad.display_name ?? 'Anuncio'}
            </Link>
          </p>
        ) : null}
        {detail.contact?.segment_slugs && detail.contact.segment_slugs.length > 0 ? (
          <span
            className="contact-segment-chips contact-segment-chips--header"
            role="group"
            aria-label="Segmentos"
          >
            {detail.contact.segment_slugs.map((slug) => (
              <SegmentBadge
                key={slug}
                colorKey={segmentColorKey(slug, segments)}
                className="inbox-chat-segment inbox-chat-segment--header"
              >
                {segmentLabel(slug, segments)}
              </SegmentBadge>
            ))}
          </span>
        ) : null}
        <p className="inbox-window-meta">
          Ventana 24 h:{' '}
          {detail.user_service_window_open ? (
            <Badge variant="success">Abierta</Badge>
          ) : (
            <Badge variant="secondary">Cerrada</Badge>
          )}
        </p>
      </div>
    </>
  )
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
  media_preview?: { url: string; mime?: string | null } | null
  campaign_preview?: {
    headerText: string
    headerMediaType: string | null
    headerMediaUrl: string | null
    bodyText: string
    footerText: string
    buttons: { type: string; text: string; url: string }[]
  } | null
  campaign_id?: number | null
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
    id: number
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
  const lastMessageIdRef = useRef(0)
  const scrollerRef = useRef<InboxMessageScrollerHandle | null>(null)
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

      const shouldScroll = scrollerRef.current?.isNearBottom() ?? true
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
        if (shouldScroll) {
          requestAnimationFrame(() => scrollerRef.current?.scrollToBottom('auto'))
        }
      }
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

  async function onMarkUnread() {
    if (!selectedId || selectedId <= 0) return
    const result = await apiClient.post<{ ok: true }>(
      `/api/conversations/${selectedId}/mark-unread`,
      {},
    )
    if (!result.ok) {
      setReplyError(result.error)
      return
    }
    navigate(`/conversations${querySuffix}`)
    void loadList()
  }

  async function onLeadScore(score: number | null) {
    if (!selectedId || selectedId <= 0) return
    const result = await apiClient.post<{ lead_score: number | null }>(
      `/api/conversations/${selectedId}/lead-score`,
      score == null
        ? { lead_score_clear: '1' }
        : { lead_score: String(score) },
    )
    if (!result.ok) {
      setReplyError(result.error)
      return
    }
    void loadDetail(selectedId)
    void loadList()
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
          <Button
            key={pill.key}
            type="button"
            size="sm"
            variant={chatFilter === pill.key ? 'default' : 'outline'}
            className="rounded-full"
            onClick={() => setChatFilter(pill.key)}
          >
            {pill.label}
          </Button>
        ))}
        {list?.ai_area_enabled ? (
          <>
            <Button
              type="button"
              size="sm"
              variant={chatFilter === 'bot' ? 'default' : 'outline'}
              className="rounded-full"
              onClick={() => setChatFilter('bot')}
            >
              Bot
            </Button>
            <Button
              type="button"
              size="sm"
              variant={chatFilter === 'human' ? 'default' : 'outline'}
              className="rounded-full"
              onClick={() => setChatFilter('human')}
            >
              Asesor
            </Button>
          </>
        ) : null}
      </div>
      <SegmentFilterChips
        segments={segments}
        selectedSlugs={selectedSegments}
        onToggle={toggleSegment}
        onClearAll={() => {
          const next = new URLSearchParams(searchParams)
          next.delete('segment')
          setSearchParams(next)
        }}
        className="conversation-segment-pills"
      />
      <form onSubmit={onSearchSubmit} className="inbox-filters">
        <div className="inbox-search-row">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Buscar en chats…"
            className="inbox-search-input"
          />
          <Button type="submit" size="sm" variant="secondary">
            Buscar
          </Button>
        </div>
      </form>
    </>
  )

  return (
    <WaPageContents>
      <WaSidebar title="Chats" filters={filterPills}>
        <ul className="inbox-chat-list">
          {!list ? (
            <li className="inbox-empty-list">Cargando…</li>
          ) : list.items.length === 0 ? (
            <li className="inbox-empty-list">No hay conversaciones.</li>
          ) : (
            list.items.map((item) => {
              const active = selectedId === item.id
              const name = displayName(item)
              const hasContactName = Boolean(item.contact_name?.trim())
              const leadScore = item.contact_lead_score
              return (
                <li
                  key={item.id}
                  className={`inbox-chat-item ${item.inbox_unread ? 'inbox-chat-item--unread' : ''} ${active ? 'is-active' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => void onSelectItem(item)}
                    className="inbox-chat-item-btn"
                  >
                    <span className="inbox-chat-avatar" aria-hidden>
                      {inboxInitials(item.contact_name, item.phone)}
                    </span>
                    <span className="inbox-chat-link-main">
                      <span className="inbox-chat-row-top">
                        <span className="inbox-chat-title-group">
                          <span className="inbox-chat-title-line">
                            <span className="inbox-chat-title">{name}</span>
                            {!hasContactName && leadScore ? <LeadStars score={leadScore} /> : null}
                          </span>
                          {conversationModeBadge(item.conversation_status)}
                        </span>
                        <span className="inbox-chat-time-wrap">
                          {item.inbox_unread ? (
                            <span className="inbox-unread-dot" title="No leído" aria-label="No leído" />
                          ) : null}
                          <span className="inbox-chat-time">
                            {formatChatListTime(item.last_message_at)}
                          </span>
                        </span>
                      </span>
                      {hasContactName ? (
                        <span className="inbox-chat-phone-row">
                          <span className="inbox-chat-phone">{item.phone}</span>
                          {leadScore ? <LeadStars score={leadScore} /> : null}
                        </span>
                      ) : null}
                      <span className="inbox-chat-row-mid">
                        <span className="inbox-chat-preview">{listPreviewText(item.preview)}</span>
                      </span>
                      {item.contact_segment_slugs.length > 0 ? (
                        <span className="contact-segment-chips" role="group" aria-label="Segmentos">
                          {item.contact_segment_slugs.map((slug) => (
                            <SegmentBadge
                              key={slug}
                              colorKey={segmentColorKey(slug, segments)}
                              className="inbox-chat-segment"
                            >
                              {segmentLabel(slug, segments)}
                            </SegmentBadge>
                          ))}
                        </span>
                      ) : null}
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
                ← Chats
              </button>
              {detail.conversation.contact_id ? (
                <Link
                  to={`/contacts/${detail.conversation.contact_id}`}
                  className="inbox-chat-header-profile inbox-chat-header-profile--link"
                  title="Ver perfil del contacto"
                >
                  <ProfileBlock detail={detail} segments={segments} />
                </Link>
              ) : (
                <div className="inbox-chat-header-profile">
                  <ProfileBlock detail={detail} segments={segments} />
                </div>
              )}
              <div className="inbox-chat-header-toolbar">
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  className="inbox-export-btn"
                  title="Descargar Excel"
                  aria-label="Descargar conversación en Excel"
                  onClick={() =>
                    void apiClient.download(`/api/conversations/${selectedId}/export`)
                  }
                >
                  ↓
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="secondary"
                      size="icon-sm"
                      title="Más"
                      aria-label="Más opciones"
                    >
                      <span className="inbox-header-more-icon" aria-hidden>
                        +
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuItem onSelect={() => void onMarkUnread()}>
                      Marcar como no leído
                    </DropdownMenuItem>
                    {!detail.contact ? (
                      <DropdownMenuItem asChild>
                        <Link
                          to={`/contacts/new?prefill_phone=${encodeURIComponent(detail.conversation.phone.replace(/\D/g, ''))}`}
                        >
                          Guardar contacto
                        </Link>
                      </DropdownMenuItem>
                    ) : null}
                    {detail.ai_area_enabled ? (
                      <>
                        <DropdownMenuSeparator />
                        <div className="inbox-mode-toggle inbox-mode-toggle--in-more px-2 py-1.5" role="group" aria-label="Modo del chat">
                          <span className="inbox-mode-toggle-label">Modo</span>
                          <div className="inbox-mode-toggle-btns">
                            {(['bot', 'human'] as const).map((mode) => (
                              <Button
                                key={mode}
                                type="button"
                                variant={detail.conversation.status === mode ? 'default' : 'outline'}
                                size="icon-sm"
                                className="inbox-mode-btn inbox-mode-btn--icon-only"
                                onClick={() => void onModeChange(mode)}
                                title={mode === 'bot' ? 'Bot' : 'Asesor'}
                                aria-label={mode === 'bot' ? 'Modo Bot' : 'Modo Asesor'}
                              >
                                <span aria-hidden>{mode === 'bot' ? '🤖' : '👤'}</span>
                              </Button>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : null}
                    {detail.contact ? (
                      <>
                        <DropdownMenuSeparator />
                        <div className="inbox-lead-score-form inbox-lead-score-form--in-more px-2 py-1.5">
                          <div className="inbox-lead-score-row">
                            <span className="inbox-lead-score-label" id="lead-score-label">
                              Calificación del lead
                            </span>
                            <div className="inbox-lead-stars-input" role="group" aria-labelledby="lead-score-label">
                              {[1, 2, 3, 4, 5].map((n) => {
                                const current = detail.contact?.lead_score ?? 0
                                return (
                                  <button
                                    key={n}
                                    type="button"
                                    className={`inbox-lead-star-btn ${n <= current ? 'is-on' : ''}`}
                                    onClick={() => void onLeadScore(n)}
                                    aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                                  >
                                    ★
                                  </button>
                                )
                              })}
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={() => void onLeadScore(null)}
                              >
                                Borrar
                              </Button>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </WaMainHeader>

            <div className="inbox-chat-body">
              <InboxMessageScroller
                ref={scrollerRef}
                conversationId={detail.conversation.id}
              >
                {detail.messages.length === 0 ? (
                  <p className="text-center text-sm text-muted">Sin mensajes aún.</p>
                ) : (
                  detail.messages.map((message) => (
                    <ChatMessageBubble
                      key={message.id}
                      message={message}
                      conversationId={detail.conversation.id}
                    />
                  ))
                )}
              </InboxMessageScroller>
            </div>

            <WaMainFooter>
              {detail.can_reply ? (
                <InboxComposeBar
                  replyText={replyText}
                  onReplyTextChange={setReplyText}
                  replyFile={replyFile}
                  onReplyFileChange={setReplyFile}
                  sendingReply={sendingReply}
                  onSubmit={(e) => void onSendReply(e)}
                  replyError={replyError}
                />
              ) : (
                <Alert>
                  <AlertDescription>{replyBlockedText(detail.reply_blocked_reason)}</AlertDescription>
                </Alert>
              )}
            </WaMainFooter>
          </>
        ) : null}
      </WaMainPane>
    </WaPageContents>
  )
}
