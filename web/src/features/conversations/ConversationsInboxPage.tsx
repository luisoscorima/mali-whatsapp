import { type FormEvent, type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { useAppUser } from '@/app/appOutletContext'
import { apiClient } from '../../shared/api'
import { formatChatListTime, chatListReplyStatus } from '../../shared/format'
import { notify } from '@/shared/notify'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import {
  WaMainPane,
  WaMainHeader,
  WaMainFooter,
} from '@/shared/ui/shell/WaMainPane'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { Badge } from '@/shared/ui/shadcn/badge'
import { Button } from '@/shared/ui/shadcn/button'
import { formatContactName } from '../contacts/contactName'
import { SegmentFilterSelect } from '../segments/SegmentFilterSelect'
import { SegmentBadge } from '../segments/SegmentBadge'
import { ChatMessageBubble } from './ChatMessageBubble'
import { ChatTimelineDateMarker, ChatTimelineEventMarker } from './ChatTimelineMarker'
import { buildChatTimeline } from './buildChatTimeline'
import { ConversationBadges } from './ConversationBadges'
import { InboxAssignDialog, type ConversationAssignee } from './InboxAssignDialog'
import { InboxChatActionsDialog } from './InboxChatActionsDialog'
import { InboxContactSheet } from './InboxContactSheet'
import { InboxSendTemplateDialog } from './InboxSendTemplateDialog'
import { ConversationsSummaryPane } from './ConversationsSummaryPane'
import { InboxComposeBar, type ReplyToMessage } from './InboxComposeBar'
import { InboxMessageScroller, type InboxMessageScrollerHandle } from './InboxMessageScroller'
import { Alert, AlertDescription } from '@/shared/ui/shadcn/alert'
import {
  chatActionsFromDetail,
  chatActionsFromListItem,
  type ChatActionsContext,
} from './inboxChatActions'

const SESSION_WINDOW_MS = 24 * 60 * 60 * 1000

/** Horas enteras restantes de la ventana 24h (ceil); null si cerrada o sin dato. */
function windowRemainingHoursLabel(
  open: boolean,
  lastUserMessageAt: string | null | undefined,
): string | null {
  if (!open || !lastUserMessageAt) return null
  const t = new Date(lastUserMessageAt).getTime()
  if (Number.isNaN(t)) return null
  const remainingMs = SESSION_WINDOW_MS - (Date.now() - t)
  if (remainingMs <= 0) return null
  const hours = Math.max(1, Math.ceil(remainingMs / (60 * 60 * 1000)))
  return `${hours}h`
}

type AssignContext = {
  conversationId: number
  heading: string
  phone: string
  assignedUserId: number | null
}
const INBOX_POLL_MS = 8000
const SEARCH_DEBOUNCE_MS = 300

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

function ProfileBlock({
  detail,
  segments,
}: {
  detail: InboxDetail
  segments: SegmentOption[]
}) {
  const user = useAppUser()
  const canManageAnuncios = Boolean(user?.canManageAnuncios)
  const contactId = detail.conversation.contact_id
  const heading = formatContactName(
    detail.contact?.name,
    detail.contact?.last_name,
    detail.conversation.phone,
  )
  const leadScore = detail.contact?.lead_score
  return (
    <>
      <span className="inbox-chat-avatar inbox-chat-avatar--header" aria-hidden>
        {inboxInitials(heading, detail.conversation.phone)}
      </span>
      <div className="inbox-chat-header-identity">
        <h1 className="inbox-chat-heading">{heading}</h1>
        <ConversationBadges
          status={detail.conversation.status}
          assignedUserLabel={detail.conversation.assigned_user_label}
          automationTouchedAt={detail.conversation.automation_touched_at}
        />
        <p className="inbox-chat-sub">
          {detail.conversation.phone}
          {contactId ? ' · Editar contacto' : ' · Añadir contacto'}
          {leadScore ? (
            <>
              {' '}
              <LeadStars score={leadScore} />
            </>
          ) : null}
        </p>
        {detail.meta_ad ? (
          <p className="inbox-chat-sub muted">
            Anuncio:{' '}
            {canManageAnuncios ? (
              <Link to={`/anuncios/${detail.meta_ad.id}`}>
                {detail.meta_ad.display_name ?? 'Anuncio'}
              </Link>
            ) : (
              (detail.meta_ad.display_name ?? 'Anuncio')
            )}
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
  assignment_group?: string | null
}

type InboxListItem = {
  id: number
  phone: string
  last_message_at: string | null
  inbox_unread: boolean
  conversation_status: string | null
  assigned_user_id: number | null
  assigned_user_label: string | null
  automation_touched_at: string | null
  contact_name: string
  contact_lead_score: number | null
  contact_segment_slugs: string[]
  preview: string
  conversation_tags: string[]
  is_virtual: boolean
  contact_id: number | null
  matched_message_id: number | null
  user_service_window_open: boolean
  last_user_message_at: string | null
  last_outbound_message_at: string | null
}

type InboxListResult = {
  items: InboxListItem[]
  total_count: number
  page: number
  pages: number
  unread_count: number
  ai_area_enabled: boolean
  can_assign_conversations: boolean
  segments: SegmentOption[]
  assignable_segments: SegmentOption[]
  filters: {
    q: string
    chat: 'all' | 'unread' | 'bot' | 'human' | 'mine' | 'unassigned' | 'new'
    segment_slugs: string[]
    include_none: boolean
  }
}

type InboxMessageReaction = {
  emoji: string
  direction: 'inbound' | 'outbound'
}

type InboxTimelineEvent = {
  id: string
  created_at: string
  label: string
}

type InboxMessage = {
  id: number
  direction: string
  body_text: string | null
  message_type: string
  created_at: string
  is_ai: boolean
  has_downloadable_media: boolean
  reaction?: InboxMessageReaction | null
  reply_to?: { message_id: number; preview: string; outbound: boolean } | null
  delivery?: { status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'; label: string } | null
  sender_label?: string | null
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
    assigned_user_id: number | null
    assigned_user_label: string | null
    automation_touched_at: string | null
  }
  contact: {
    name: string | null
    last_name: string | null
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
  events: InboxTimelineEvent[]
  tags: string[]
  can_reply: boolean
  reply_blocked_reason: '24h' | 'bot_mode' | null
  user_service_window_open: boolean
  ai_area_enabled: boolean
  can_assign_conversations: boolean
}

type InboxConversationUpdates = {
  messages: InboxMessage[]
  message_reactions: { id: number; reaction: InboxMessageReaction | null }[]
  message_deliveries: { id: number; delivery: InboxMessage['delivery'] }[]
  events: InboxTimelineEvent[]
  conversation: {
    last_message_at: string | null
    last_user_message_at: string | null
    status: string
    inbox_unread: boolean
    assigned_user_id: number | null
    assigned_user_label: string | null
    automation_touched_at: string | null
  }
  can_reply: boolean
  reply_blocked_reason: '24h' | 'bot_mode' | null
  user_service_window_open: boolean
}

function inboxApiQuery(searchParams: URLSearchParams, extra?: { msg?: number }): string {
  const qs = new URLSearchParams()
  const q = searchParams.get('q')
  if (q) qs.set('q', q)
  const chat = searchParams.get('chat')
  if (chat && chat !== 'all') qs.set('chat', chat)
  searchParams.getAll('segment').forEach((slug) => qs.append('segment', slug))
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  if (page > 1) qs.set('page', String(page))
  if (extra?.msg) qs.set('msg', String(extra.msg))
  const value = qs.toString()
  return value ? `?${value}` : ''
}

function inboxFilterKeyFromParams(searchParams: URLSearchParams): string {
  const q = (searchParams.get('q') ?? '').trim()
  const chat = searchParams.get('chat') || 'all'
  const segments = searchParams.getAll('segment').sort().join('\0')
  return `${q}\n${chat}\n${segments}`
}

function inboxFilterKeyFromResult(filters: InboxListResult['filters']): string {
  const segments = [...filters.segment_slugs]
  if (filters.include_none) segments.push('__none__')
  return `${filters.q}\n${filters.chat}\n${segments.sort().join('\0')}`
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

function mergeMessageReactions(
  messages: InboxMessage[],
  patches: { id: number; reaction: InboxMessageReaction | null }[],
): InboxMessage[] {
  if (!patches.length) return messages
  const patchMap = new Map(patches.map((patch) => [patch.id, patch.reaction]))
  return messages.map((message) =>
    patchMap.has(message.id)
      ? { ...message, reaction: patchMap.get(message.id) ?? null }
      : message,
  )
}

function mergeMessageDeliveries(
  messages: InboxMessage[],
  patches: { id: number; delivery: InboxMessage['delivery'] }[],
): InboxMessage[] {
  if (!patches.length) return messages
  const patchMap = new Map(patches.map((patch) => [patch.id, patch.delivery]))
  return messages.map((message) =>
    patchMap.has(message.id)
      ? { ...message, delivery: patchMap.get(message.id) ?? null }
      : message,
  )
}

function mergeTimelineEvents(
  prev: InboxTimelineEvent[],
  incoming: InboxTimelineEvent[],
): InboxTimelineEvent[] {
  if (!incoming.length) return prev
  const known = new Set(prev.map((event) => event.id))
  const merged = [...prev]
  for (const event of incoming) {
    if (!known.has(event.id)) merged.push(event)
  }
  merged.sort((a, b) => {
    const at = new Date(a.created_at).getTime()
    const bt = new Date(b.created_at).getTime()
    return at - bt || a.id.localeCompare(b.id)
  })
  return merged
}

function maxAuditId(events: InboxTimelineEvent[]): bigint {
  let max = BigInt(0)
  for (const event of events) {
    try {
      const id = BigInt(event.id)
      if (id > max) max = id
    } catch {
      // ignore malformed ids
    }
  }
  return max
}

function messageReplyPreview(message: InboxMessage): string {
  const text = message.body_text?.trim()
  if (text) return text.length > 120 ? `${text.slice(0, 120)}…` : text
  const mt = message.message_type.toLowerCase()
  if (mt === 'image') return 'Imagen'
  if (mt === 'video') return 'Video'
  if (mt === 'audio' || mt === 'voice') return 'Audio'
  if (mt === 'document') return 'Documento'
  if (mt === 'campaign') return 'Campaña'
  return 'Mensaje'
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
  const [replyText, setReplyText] = useState('')
  const [replyFile, setReplyFile] = useState<File | null>(null)
  const [sendingReply, setSendingReply] = useState(false)
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '')
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set())
  const [bulkSegment, setBulkSegment] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [actionsContext, setActionsContext] = useState<ChatActionsContext | null>(null)
  const [contactSheetOpen, setContactSheetOpen] = useState(false)
  const [contactSheetMode, setContactSheetMode] = useState<'edit' | 'create'>('edit')
  const [contactSheetContactId, setContactSheetContactId] = useState<number | null>(null)
  const [contactSheetPhone, setContactSheetPhone] = useState('')
  const [replyToMessage, setReplyToMessage] = useState<ReplyToMessage | null>(null)
  const [assignContext, setAssignContext] = useState<AssignContext | null>(null)
  const [assignees, setAssignees] = useState<ConversationAssignee[]>([])
  const [assigneesLoading, setAssigneesLoading] = useState(false)
  const [assignSaving, setAssignSaving] = useState(false)
  const lastMessageIdRef = useRef(0)
  const lastAuditIdRef = useRef<bigint>(BigInt(0))
  const listRequestIdRef = useRef(0)
  const scrollerRef = useRef<InboxMessageScrollerHandle | null>(null)
  const sendingReplyRef = useRef(false)

  const selectedId = idParam ? Number(idParam) : null
  const filterQuerySuffix = useMemo(() => {
    const sp = new URLSearchParams(searchParams)
    sp.delete('msg')
    return inboxApiQuery(sp)
  }, [searchParams])
  const searchQuery = (searchParams.get('q') ?? '').trim()
  const highlightMsgId = Number(searchParams.get('msg') || '') || null
  const chatFilter = (searchParams.get('chat') || 'all') as InboxListResult['filters']['chat']
  const selectedSegments = searchParams.getAll('segment')
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const activeFilterKey = useMemo(
    () => inboxFilterKeyFromParams(searchParams),
    [searchParams],
  )

  const loadList = useCallback((opts?: { silent?: boolean }) => {
    const requestId = ++listRequestIdRef.current
    return apiClient
      .get<InboxListResult>(`/api/conversations${filterQuerySuffix}`)
      .then((result) => {
        if (requestId !== listRequestIdRef.current) return
        if (!result.ok) {
          if (!opts?.silent) {
            notify.error(result.error)
            setError(result.error)
          }
          return
        }
        setList(result.data)
      })
  }, [filterQuerySuffix])

  useEffect(() => {
    setSelectedContactIds(new Set())
    setBulkSegment('')
  }, [filterQuerySuffix])

  const listCount = useMemo(() => {
    if (!list) return null
    if (inboxFilterKeyFromResult(list.filters) !== activeFilterKey) return null
    return list.total_count ?? list.items.length
  }, [list, activeFilterKey])

  const listPages = useMemo(() => {
    if (!list) return 0
    if (inboxFilterKeyFromResult(list.filters) !== activeFilterKey) return 0
    return list.pages
  }, [list, activeFilterKey])

  const listPage =
    list && inboxFilterKeyFromResult(list.filters) === activeFilterKey ? list.page : page

  const loadDetail = useCallback(
    (conversationId: number) => {
      setLoadingDetail(true)
      setError('')
      return apiClient
        .get<InboxDetail>(`/api/conversations/${conversationId}`)
        .then((result) => {
          setLoadingDetail(false)
          if (!result.ok) {
            notify.error(result.error)
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

  const conversationPath = useCallback(
    (conversationId: number, item?: InboxListItem): string => {
      return `/conversations/${conversationId}${inboxApiQuery(searchParams, {
        msg: item?.matched_message_id ?? undefined,
      })}`
    },
    [searchParams],
  )

  const pollConversationUpdates = useCallback(
    async (conversationId: number) => {
      const afterId = lastMessageIdRef.current
      const afterAuditId = lastAuditIdRef.current
      const result = await apiClient.get<InboxConversationUpdates>(
        `/api/conversations/${conversationId}/updates?after_message_id=${afterId}&after_audit_id=${afterAuditId.toString()}`,
      )
      if (!result.ok) return

      const shouldScroll = scrollerRef.current?.isNearBottom() ?? true
      const incoming = result.data.messages
      const reactionPatches = result.data.message_reactions ?? []
      const deliveryPatches = result.data.message_deliveries ?? []
      const incomingEvents = result.data.events ?? []

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
          messages: mergeMessageDeliveries(
            mergeMessageReactions(merged, reactionPatches),
            deliveryPatches,
          ),
          events: mergeTimelineEvents(prev.events ?? [], incomingEvents),
          conversation: {
            ...prev.conversation,
            status: result.data.conversation.status,
            last_message_at: result.data.conversation.last_message_at,
            last_user_message_at: result.data.conversation.last_user_message_at,
            inbox_unread: result.data.conversation.inbox_unread,
            assigned_user_id: result.data.conversation.assigned_user_id,
            assigned_user_label: result.data.conversation.assigned_user_label,
            automation_touched_at: result.data.conversation.automation_touched_at,
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
      } else if ((reactionPatches.length > 0 || incomingEvents.length > 0) && shouldScroll) {
        requestAnimationFrame(() => scrollerRef.current?.scrollToBottom('auto'))
      }

      if (incomingEvents.length > 0) {
        const nextAudit = maxAuditId(incomingEvents)
        if (nextAudit > lastAuditIdRef.current) {
          lastAuditIdRef.current = nextAudit
        }
      }
    },
    [],
  )

  useEffect(() => {
    if (!detail?.messages.length) {
      lastMessageIdRef.current = 0
    } else {
      lastMessageIdRef.current = Math.max(...detail.messages.map((message) => message.id))
    }
    lastAuditIdRef.current = maxAuditId(detail?.events ?? [])
  }, [detail?.conversation.id, detail?.messages, detail?.events])

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
            notify.error(result.error)
            setError(result.error)
            setLoadingDetail(false)
            return
          }
          navigate(conversationPath(result.data.id), { replace: true })
        })
      return
    }

    setLoadingDetail(true)
    setError('')
    void loadDetail(selectedId)
  }, [selectedId, navigate, loadDetail, conversationPath])

  const resolvedHighlightMsgId = useMemo(() => {
    if (highlightMsgId) return highlightMsgId
    if (!searchQuery || !detail?.messages.length) return null
    const q = searchQuery.toLowerCase()
    const match = detail.messages.find((message) =>
      message.body_text?.toLowerCase().includes(q),
    )
    return match?.id ?? null
  }, [highlightMsgId, searchQuery, detail?.messages])

  const messageById = useMemo(
    () => new Map((detail?.messages ?? []).map((message) => [message.id, message])),
    [detail?.messages],
  )

  const timelineItems = useMemo(
    () => buildChatTimeline(detail?.messages ?? [], detail?.events ?? []),
    [detail?.messages, detail?.events],
  )

  const detailHeading = detail
    ? formatContactName(
        detail.contact?.name,
        detail.contact?.last_name,
        detail.conversation.phone,
      )
    : ''

  useEffect(() => {
    setReplyText('')
    setReplyFile(null)
    setReplyToMessage(null)
  }, [selectedId])

  function openChatActions(ctx: ChatActionsContext) {
    setActionsContext(ctx)
    setActionsOpen(true)
  }

  function openAssignDialog(source: AssignContext) {
    setAssignContext(source)
  }

  function openAssignFromActions(ctx: ChatActionsContext) {
    if (!ctx.conversationId || ctx.conversationId <= 0) return
    openAssignDialog({
      conversationId: ctx.conversationId,
      heading: ctx.heading,
      phone: ctx.phone,
      assignedUserId: ctx.assignedUserId,
    })
  }

  function openContactSheet(opts: {
    mode: 'edit' | 'create'
    contactId?: number | null
    phone: string
  }) {
    setContactSheetMode(opts.mode)
    setContactSheetContactId(opts.contactId ?? null)
    setContactSheetPhone(opts.phone)
    setContactSheetOpen(true)
  }

  const actionsConversationId = actionsContext?.conversationId ?? null

  const urlQ = searchParams.get('q') ?? ''
  useEffect(() => {
    setSearchInput(urlQ)
  }, [urlQ])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const q = searchInput.trim()
      const next = new URLSearchParams(searchParams)
      next.delete('msg')
      const currentQ = (next.get('q') ?? '').trim()
      if (q === currentQ) return
      next.delete('page')
      if (q) next.set('q', q)
      else next.delete('q')
      setSearchParams(next)
    }, SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [searchInput, searchParams, setSearchParams])

  function setChatFilter(chat: InboxListResult['filters']['chat']) {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    if (chat === 'all') next.delete('chat')
    else next.set('chat', chat)
    setSearchParams(next)
  }

  function toggleSegment(slug: string) {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    const current = next.getAll('segment')
    if (current.includes(slug)) {
      next.delete('segment')
      current.filter((s) => s !== slug).forEach((s) => next.append('segment', s))
    } else {
      next.append('segment', slug)
    }
    setSearchParams(next)
  }

  function onSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter') {
      event.preventDefault()
      const q = searchInput.trim()
      const next = new URLSearchParams(searchParams)
      next.delete('msg')
      next.delete('page')
      if (q) next.set('q', q)
      else next.delete('q')
      setSearchParams(next)
    }
  }

  function goToPage(nextPage: number) {
    const next = new URLSearchParams(searchParams)
    if (nextPage <= 1) next.delete('page')
    else next.set('page', String(nextPage))
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
        notify.error(result.error)
        setError(result.error)
        return
      }
      navigate(conversationPath(result.data.id, item))
      return
    }
    navigate(conversationPath(item.id, item))
  }

  async function onModeChange(status: 'bot' | 'human') {
    const convId = actionsConversationId ?? selectedId
    if (!convId || convId <= 0) return
    const result = await apiClient.patch<{ status: 'bot' | 'human' }>(
      `/api/conversations/${convId}/mode`,
      { status },
    )
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    if (selectedId === convId) void loadDetail(convId)
    void loadList()
  }

  async function onMarkUnread() {
    const convId = actionsConversationId ?? selectedId
    if (!convId || convId <= 0) return
    const result = await apiClient.post<{ ok: true }>(
      `/api/conversations/${convId}/mark-unread`,
      {},
    )
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    if (selectedId === convId) {
      navigate(`/conversations${filterQuerySuffix}`)
    }
    void loadList()
  }

  async function onLeadScore(score: number | null) {
    const convId = actionsConversationId ?? selectedId
    if (!convId || convId <= 0) return
    const result = await apiClient.post<{ lead_score: number | null }>(
      `/api/conversations/${convId}/lead-score`,
      score == null
        ? { lead_score_clear: '1' }
        : { lead_score: String(score) },
    )
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    if (selectedId === convId) void loadDetail(convId)
    void loadList()
  }

  function onMessageCopy(message: InboxMessage) {
    const text = message.body_text?.trim()
    if (!text) return
    void navigator.clipboard.writeText(text)
  }

  function onMessageReply(message: InboxMessage) {
    setReplyToMessage({
      id: message.id,
      preview: messageReplyPreview(message),
      outbound: message.direction === 'outbound',
    })
  }

  async function onMessageReact(message: InboxMessage, emoji: string) {
    if (!selectedId || selectedId <= 0 || !detail?.can_reply) {
      notify.error('No puedes reaccionar en este momento')
      return
    }
    const result = await apiClient.post<{
      ok: true
      target_message_id: number
      reaction: InboxMessageReaction | null
    }>(`/api/conversations/${selectedId}/messages/${message.id}/react`, { emoji })
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setDetail((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        messages: mergeMessageReactions(prev.messages, [
          { id: result.data.target_message_id, reaction: result.data.reaction },
        ]),
      }
    })
  }

  async function onSendReply(event: FormEvent) {
    event.preventDefault()
    if (!selectedId || selectedId <= 0 || !detail?.can_reply) return
    const text = replyText.trim()
    if (!text && !replyFile) {
      notify.error('Escribe un mensaje o adjunta un archivo')
      return
    }
    setSendingReply(true)
    const replyPayload = replyToMessage
      ? { message: text, reply_to_message_id: replyToMessage.id }
      : { message: text }
    const result = replyFile
      ? await (() => {
          const formData = new FormData()
          if (text) formData.append('message', text)
          formData.append('file', replyFile)
          if (replyToMessage) {
            formData.append('reply_to_message_id', String(replyToMessage.id))
          }
          return apiClient.postFormData<{ messages: InboxMessage[] }>(
            `/api/conversations/${selectedId}/reply`,
            formData,
          )
        })()
      : await apiClient.post<{ messages: InboxMessage[] }>(
          `/api/conversations/${selectedId}/reply`,
          replyPayload,
        )
    setSendingReply(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setReplyText('')
    setReplyFile(null)
    setReplyToMessage(null)
    void loadDetail(selectedId)
    void loadList()
  }

  const canAssign =
    detail?.can_assign_conversations ?? list?.can_assign_conversations ?? false

  useEffect(() => {
    if (!assignContext || !canAssign) return
    setAssigneesLoading(true)
    void apiClient
      .get<{ assignees: ConversationAssignee[] }>('/api/conversations/assignees')
      .then((result) => {
        setAssigneesLoading(false)
        if (!result.ok) {
          notify.error(result.error)
          return
        }
        setAssignees(result.data.assignees)
      })
  }, [assignContext, canAssign])

  async function onAssign(assignedUserId: number | null) {
    const convId = assignContext?.conversationId
    if (!convId || convId <= 0) return
    setAssignSaving(true)
    const result = await apiClient.patch<{
      assigned_user_id: number | null
      assigned_user_label: string | null
    }>(`/api/conversations/${convId}/assign`, { assigned_user_id: assignedUserId })
    setAssignSaving(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setAssignContext(null)
    if (selectedId === convId) void loadDetail(convId)
    void loadList()
  }

  const segments = list?.segments ?? []
  const assignableSegments = list?.assignable_segments ?? []
  const assignableByGroup = useMemo(() => {
    const groups = new Map<string, SegmentOption[]>()
    for (const seg of assignableSegments) {
      const key = (seg.assignment_group ?? '').trim() || 'otros'
      const rows = groups.get(key) ?? []
      rows.push(seg)
      groups.set(key, rows)
    }
    return [...groups.entries()]
  }, [assignableSegments])

  function contactIdForBulk(item: InboxListItem): number | null {
    if (item.contact_id && item.contact_id > 0) return item.contact_id
    return null
  }

  function toggleContactSelection(contactId: number) {
    setSelectedContactIds((prev) => {
      const next = new Set(prev)
      if (next.has(contactId)) next.delete(contactId)
      else next.add(contactId)
      return next
    })
  }

  function selectAllVisibleContacts() {
    if (!list) return
    const ids = list.items
      .map((item) => contactIdForBulk(item))
      .filter((id): id is number => id != null)
    setSelectedContactIds(new Set(ids))
  }

  function clearContactSelection() {
    setSelectedContactIds(new Set())
  }

  async function handleBulkAssignableSegment(e: FormEvent) {
    e.preventDefault()
    if (!bulkSegment || selectedContactIds.size === 0) return
    setBulkBusy(true)
    const res = await apiClient.post<{ updated: number }>(
      '/api/contacts/bulk-add-segment',
      {
        segment_slug: bulkSegment,
        contact_ids: [...selectedContactIds],
        assignable_only: true,
      },
    )
    setBulkBusy(false)
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    notify.success(`Segmento aplicado a ${res.data.updated} contacto(s)`)
    clearContactSelection()
    setBulkSegment('')
    void loadList({ silent: true })
  }
  const displayName = (item: InboxListItem) =>
    formatContactName(item.contact_name, null, item.phone)

  if (error && !list) {
    return <p className="text-muted p-4">No se pudo cargar</p>
  }

  const filterPills = (
    <>
      <div
        className="inbox-chat-filter-pills inbox-chat-filter-pills--row inbox-chat-filter-pills--compact"
        aria-label="Filtrar lista"
      >
        {(
          [
            { key: 'all', label: 'Todos' },
            { key: 'unread', label: list?.unread_count ? `Sin leer (${list.unread_count})` : 'Sin leer' },
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
          <Button
            type="button"
            size="sm"
            variant={chatFilter === 'bot' ? 'default' : 'outline'}
            className="rounded-full"
            onClick={() => setChatFilter('bot')}
          >
            Bot
          </Button>
        ) : null}
        {(
          [
            { key: 'mine', label: 'Mis chats' },
            { key: 'unassigned', label: 'Sin asignar' },
            { key: 'new', label: 'Nuevo' },
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
      </div>
      <SegmentFilterSelect
        segments={segments}
        selectedSlugs={selectedSegments}
        onToggle={toggleSegment}
        onClearAll={() => {
          const next = new URLSearchParams(searchParams)
          next.delete('segment')
          next.delete('page')
          setSearchParams(next)
        }}
      />
      <div className="inbox-filters">
        <div className="inbox-search-row">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Buscar nombre, teléfono, mensaje, segmento o atributo…"
            className="inbox-search-input"
            aria-label="Buscar en chats"
          />
        </div>
      </div>
      {listCount != null ? (
        <p className="text-xs text-muted">
          {listCount} chat{listCount === 1 ? '' : 's'}
        </p>
      ) : null}
      {assignableSegments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          <button
            type="button"
            className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-surface"
            onClick={selectAllVisibleContacts}
          >
            Todos
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-surface"
            onClick={clearContactSelection}
          >
            Ninguno
          </button>
          {selectedContactIds.size > 0 ? (
            <form
              onSubmit={(e) => void handleBulkAssignableSegment(e)}
              className="flex min-w-0 flex-1 flex-wrap items-end gap-1"
            >
              <select
                value={bulkSegment}
                onChange={(e) => setBulkSegment(e.target.value)}
                required
                className="min-w-0 flex-1 rounded border border-line bg-bg px-1 py-0.5 text-xs"
              >
                <option value="">Segmento asignable</option>
                {assignableByGroup.map(([group, segs]) => (
                  <optgroup key={group} label={group}>
                    {segs.map((seg) => (
                      <option key={seg.slug} value={seg.slug}>
                        {seg.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <button
                type="submit"
                disabled={bulkBusy || !bulkSegment}
                className="rounded-lg border border-line bg-surface-strong px-2 py-1 text-xs font-semibold hover:bg-surface disabled:opacity-50"
              >
                {bulkBusy ? '…' : `Aplicar (${selectedContactIds.size})`}
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </>
  )

  return (
    <WaPageContents>
      <WaSidebar
        title={listCount != null ? `Chats (${listCount})` : 'Chats'}
        filters={filterPills}
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
              const hasContactName = Boolean(item.contact_name?.trim())
              const leadScore = item.contact_lead_score
              const windowHours = !item.is_virtual
                ? windowRemainingHoursLabel(
                    item.user_service_window_open,
                    item.last_user_message_at,
                  )
                : null
              const replyStatus = chatListReplyStatus(
                item.last_user_message_at,
                item.last_outbound_message_at,
                { windowOpen: item.user_service_window_open },
              )
              return (
                <li
                  key={item.id}
                  className={`inbox-chat-item ${item.inbox_unread ? 'inbox-chat-item--unread' : ''} ${active ? 'is-active' : ''}`}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openChatActions(
                      chatActionsFromListItem(item, list.ai_area_enabled, name),
                    )
                  }}
                >
                  {assignableSegments.length > 0 ? (
                    <label
                      className="flex w-7 shrink-0 items-center justify-center self-stretch"
                      onClick={(event) => event.stopPropagation()}
                    >
                      {contactIdForBulk(item) != null ? (
                        <input
                          type="checkbox"
                          checked={selectedContactIds.has(contactIdForBulk(item)!)}
                          onChange={() => toggleContactSelection(contactIdForBulk(item)!)}
                          onClick={(event) => event.stopPropagation()}
                          aria-label={`Seleccionar ${name}`}
                        />
                      ) : null}
                    </label>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void onSelectItem(item)}
                    className="inbox-chat-item-btn"
                  >
                    <span
                      className={`inbox-chat-avatar ${
                        !item.is_virtual
                          ? item.user_service_window_open
                            ? 'inbox-chat-avatar--window-open'
                            : 'inbox-chat-avatar--window-closed'
                          : ''
                      }`}
                      aria-hidden
                      title={
                        !item.is_virtual
                          ? item.user_service_window_open
                            ? windowHours
                              ? `Ventana 24h abierta (${windowHours})`
                              : 'Ventana 24h abierta'
                            : 'Ventana 24h cerrada'
                          : undefined
                      }
                    >
                      {inboxInitials(item.contact_name, item.phone)}
                      {!item.is_virtual && !item.user_service_window_open ? (
                        <span className="inbox-chat-avatar-lock" aria-hidden>
                          🔒
                        </span>
                      ) : null}
                      {windowHours ? (
                        <span className="inbox-chat-avatar-hours" aria-hidden>
                          {windowHours}
                        </span>
                      ) : null}
                    </span>
                    <span className="inbox-chat-link-main">
                      <span className="inbox-chat-row-top">
                        <span className="inbox-chat-title-group">
                          <span className="inbox-chat-title-line">
                            <span className="inbox-chat-title">{name}</span>
                            {!hasContactName && leadScore ? <LeadStars score={leadScore} /> : null}
                          </span>
                          <ConversationBadges
                            status={item.conversation_status}
                            assignedUserLabel={item.assigned_user_label}
                            automationTouchedAt={item.automation_touched_at}
                          />
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
                  <div className="inbox-chat-side">
                    <span className="inbox-chat-time-wrap">
                      {item.inbox_unread ? (
                        <span className="inbox-unread-dot" title="No leído" aria-label="No leído" />
                      ) : null}
                      <span
                        className="inbox-chat-msg-times"
                        title={[
                          `Entrante: ${formatChatListTime(item.last_user_message_at)}`,
                          `Saliente: ${formatChatListTime(item.last_outbound_message_at)}`,
                          replyStatus?.title,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      >
                        <span className="inbox-chat-msg-time">
                          <span aria-hidden>↓</span>
                          {formatChatListTime(item.last_user_message_at)}
                        </span>
                        <span className="inbox-chat-msg-time">
                          <span aria-hidden>↑</span>
                          {formatChatListTime(item.last_outbound_message_at)}
                        </span>
                        <span
                          className={`inbox-chat-msg-time inbox-chat-msg-time--lag${
                            replyStatus?.symbol === '⏳' ? ' is-waiting' : ''
                          }`}
                        >
                          <span aria-hidden>{replyStatus?.symbol ?? '⏱'}</span>
                          {replyStatus?.label ?? '—'}
                        </span>
                      </span>
                    </span>
                    <button
                      type="button"
                      className="inbox-chat-item-more"
                      aria-label="Opciones del chat"
                      title="Opciones del chat"
                      onClick={(event) => {
                        event.stopPropagation()
                        openChatActions(
                          chatActionsFromListItem(item, list.ai_area_enabled, name),
                        )
                      }}
                    >
                      <span aria-hidden>▾</span>
                    </button>
                  </div>
                </li>
              )
            })
          )}
          {listPages > 1 ? (
            <li className="inbox-chat-list-pager">
              <span className="inbox-chat-list-pager-label muted">
                Pág. {listPage}/{listPages}
              </span>
              <button
                type="button"
                disabled={listPage <= 1}
                onClick={() => goToPage(listPage - 1)}
                className="small-btn"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={listPage >= listPages}
                onClick={() => goToPage(listPage + 1)}
                className="small-btn"
              >
                Siguiente
              </button>
            </li>
          ) : null}
        </ul>
      </WaSidebar>

      <WaMainPane>
        {selectedId == null ? (
          <ConversationsSummaryPane />
        ) : loadingDetail && !detail ? (
          <WaEmptyPane heading="Cargando chat…" />
        ) : error && !detail ? (
          <WaEmptyPane heading="No se pudo cargar" />
        ) : detail ? (
          <>
            <WaMainHeader>
              <button
                type="button"
                className="inbox-back-mobile"
                onClick={() => navigate(`/conversations${filterQuerySuffix}`)}
              >
                ← Chats
              </button>
              <button
                type="button"
                className="inbox-chat-header-profile inbox-chat-header-profile--link"
                title={
                  detail.conversation.contact_id
                    ? 'Editar contacto'
                    : 'Añadir contacto'
                }
                onClick={() =>
                  openContactSheet({
                    mode: detail.conversation.contact_id ? 'edit' : 'create',
                    contactId: detail.conversation.contact_id,
                    phone: detail.conversation.phone,
                  })
                }
              >
                <ProfileBlock detail={detail} segments={segments} />
              </button>
              <div className="inbox-chat-header-toolbar">
                {!detail.user_service_window_open ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setTemplateOpen(true)}
                  >
                    Enviar plantilla
                  </Button>
                ) : null}
                {canAssign ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() =>
                      openAssignDialog({
                        conversationId: detail.conversation.id,
                        heading: detailHeading,
                        phone: detail.conversation.phone,
                        assignedUserId: detail.conversation.assigned_user_id,
                      })
                    }
                  >
                    Asignar
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="secondary"
                  size="icon-sm"
                  title="Opciones del chat"
                  aria-label="Opciones del chat"
                  onClick={() =>
                    openChatActions(
                      chatActionsFromDetail(detail, detailHeading, detail.ai_area_enabled),
                    )
                  }
                >
                  <span className="inbox-header-more-icon" aria-hidden>
                    ⋮
                  </span>
                </Button>
              </div>
            </WaMainHeader>

            <div className="inbox-chat-body">
              <InboxMessageScroller
                ref={scrollerRef}
                conversationId={detail.conversation.id}
                scrollToMessageId={resolvedHighlightMsgId}
              >
                {timelineItems.length === 0 ? (
                  <p className="text-center text-sm text-muted">Sin mensajes aún.</p>
                ) : (
                  timelineItems.map((item) => {
                    if (item.type === 'date') {
                      return <ChatTimelineDateMarker key={item.key} label={item.label} />
                    }
                    if (item.type === 'event') {
                      return (
                        <ChatTimelineEventMarker key={item.key} label={item.event.label} />
                      )
                    }
                    const message = messageById.get(item.messageId)
                    if (!message) return null
                    return (
                      <ChatMessageBubble
                        key={item.key}
                        message={message}
                        conversationId={detail.conversation.id}
                        highlightQuery={searchQuery}
                        isHighlighted={resolvedHighlightMsgId === message.id}
                        canInteract={detail.can_reply}
                        onReply={onMessageReply}
                        onCopy={onMessageCopy}
                        onReact={(msg, emoji) => void onMessageReact(msg, emoji)}
                      />
                    )
                  })
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
                  replyTo={replyToMessage}
                  onClearReplyTo={() => setReplyToMessage(null)}
                />
              ) : (
                <Alert>
                  <AlertDescription>
                    {replyBlockedText(detail.reply_blocked_reason) ||
                      'No puedes responder en este momento.'}
                  </AlertDescription>
                </Alert>
              )}
            </WaMainFooter>
          </>
        ) : null}
      </WaMainPane>

      {actionsContext ? (
        <InboxChatActionsDialog
          open={actionsOpen}
          onOpenChange={(open) => {
            setActionsOpen(open)
            if (!open) setActionsContext(null)
          }}
          conversationId={actionsContext.conversationId}
          heading={actionsContext.heading}
          phone={actionsContext.phone}
          contactId={actionsContext.contactId}
          leadScore={actionsContext.leadScore}
          aiAreaEnabled={actionsContext.aiAreaEnabled}
          conversationStatus={actionsContext.conversationStatus}
          canAssign={canAssign}
          assignableSegments={list?.assignable_segments ?? []}
          currentSegmentSlugs={
            detail?.contact?.segment_slugs ??
            list?.items.find((i) => i.id === actionsContext.conversationId)
              ?.contact_segment_slugs ??
            []
          }
          onLeadScore={onLeadScore}
          onMarkUnread={onMarkUnread}
          onModeChange={onModeChange}
          onAssign={() => openAssignFromActions(actionsContext)}
          onOpenContact={() =>
            openContactSheet({
              mode: actionsContext.contactId ? 'edit' : 'create',
              contactId: actionsContext.contactId,
              phone: actionsContext.phone,
            })
          }
          onSegmentAdded={() => {
            void loadList()
            if (selectedId) void loadDetail(selectedId)
          }}
          onExport={() => {
            const convId = actionsContext.conversationId
            if (!convId) return
            void apiClient.download(`/api/conversations/${convId}/export`)
          }}
        />
      ) : null}

      <InboxContactSheet
        open={contactSheetOpen}
        onOpenChange={setContactSheetOpen}
        mode={contactSheetMode}
        contactId={contactSheetContactId}
        prefillPhone={contactSheetPhone}
        onSaved={() => {
          void loadList()
          if (selectedId) void loadDetail(selectedId)
        }}
      />

      {detail && selectedId ? (
        <InboxSendTemplateDialog
          open={templateOpen}
          onOpenChange={setTemplateOpen}
          conversationId={selectedId}
          onSent={() => {
            void loadDetail(selectedId)
            void loadList()
          }}
        />
      ) : null}

      {assignContext ? (
        <InboxAssignDialog
          open={Boolean(assignContext)}
          onOpenChange={(open) => {
            if (!open) setAssignContext(null)
          }}
          heading={assignContext.heading}
          phone={assignContext.phone}
          currentAssigneeId={assignContext.assignedUserId}
          assignees={assignees}
          loading={assigneesLoading}
          saving={assignSaving}
          onSave={(assignedUserId) => void onAssign(assignedUserId)}
        />
      ) : null}
    </WaPageContents>
  )
}
