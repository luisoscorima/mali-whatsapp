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
import { InboxStartFlowMenu } from './InboxStartFlowMenu'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@/shared/ui/shadcn/context-menu'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/shadcn/dropdown-menu'
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
const WINDOW_MAX_BUCKETS = [2, 6, 12, 24] as const
type WindowMaxFilter = (typeof WINDOW_MAX_BUCKETS)[number] | null

function parseWindowMaxFilter(raw: string | null): WindowMaxFilter {
  const n = Number(raw ?? '')
  return WINDOW_MAX_BUCKETS.includes(n as (typeof WINDOW_MAX_BUCKETS)[number])
    ? (n as WindowMaxFilter)
    : null
}

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

function WindowClockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  )
}

/** Caja + flecha abajo, estilo WhatsApp / archive. */
function ArchiveChatsIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="21 8 21 21 3 21 3 8" />
      <rect x="1" y="3" width="22" height="5" rx="1" />
      <line x1="10" y1="12" x2="14" y2="12" />
    </svg>
  )
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

function ContactSheetIcon({ mode }: { mode: 'edit' | 'create' }) {
  if (mode === 'create') {
    return (
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <line x1="19" y1="8" x2="19" y2="14" />
        <line x1="22" y1="11" x2="16" y2="11" />
      </svg>
    )
  }
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

function ProfileBlock({
  detail,
  segments,
  onOpenContact,
}: {
  detail: InboxDetail
  segments: SegmentOption[]
  onOpenContact: () => void
}) {
  const user = useAppUser()
  const canManageAnuncios = Boolean(user?.canManageAnuncios)
  const contactId = detail.conversation.contact_id
  const contactMode = contactId ? 'edit' : 'create'
  const contactActionLabel = contactId ? 'Editar contacto' : 'Añadir contacto'
  const crmName = formatContactName(
    detail.contact?.name,
    detail.contact?.last_name,
  )
  const waAlias = String(detail.conversation.wa_profile_name ?? '').trim()
  const isWaAlias = !crmName && Boolean(waAlias)
  const heading = crmName || waAlias || detail.conversation.phone
  const leadScore = detail.contact?.lead_score
  return (
    <>
      <span className="inbox-chat-avatar inbox-chat-avatar--header" aria-hidden>
        {inboxInitials(crmName || waAlias, detail.conversation.phone)}
      </span>
      <div className="inbox-chat-header-identity">
        <div className="inbox-chat-heading-row">
          <h1 className={`inbox-chat-heading${isWaAlias ? ' muted' : ''}`}>
            {heading}
          </h1>
          <button
            type="button"
            className="inbox-chat-contact-icon-btn"
            title={contactActionLabel}
            aria-label={contactActionLabel}
            onClick={onOpenContact}
          >
            <ContactSheetIcon mode={contactMode} />
          </button>
        </div>
        <ConversationBadges
          status={detail.conversation.status}
          assignedUserLabel={detail.conversation.assigned_user_label}
        />
        <p className="inbox-chat-sub">
          {detail.conversation.phone}
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
  wa_profile_name: string | null
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
  archived: boolean
}

type InboxListResult = {
  items: InboxListItem[]
  total_count: number
  page: number
  pages: number
  unread_count: number
  archived_count: number
  ai_area_enabled: boolean
  can_assign_conversations: boolean
  segments: SegmentOption[]
  assignable_segments: SegmentOption[]
  filters: {
    q: string
    chat: 'all' | 'unread' | 'bot' | 'human' | 'mine' | 'unassigned' | 'unanswered' | 'archived' | 'archived_auto' | 'archived_manual'
    window_max: WindowMaxFilter
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
    archived?: boolean
    contact_id: number | null
    wa_profile_name: string | null
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
    archived: boolean
    assigned_user_id: number | null
    assigned_user_label: string | null
    automation_touched_at: string | null
  }
  can_reply: boolean
  reply_blocked_reason: '24h' | 'bot_mode' | null
  user_service_window_open: boolean
}

function normalizeInboxChatParam(
  raw: string | null,
): InboxListResult['filters']['chat'] {
  const chat = raw || 'all'
  // Legacy: «Nuevo» unificado en «Sin asignar».
  if (chat === 'new') return 'unassigned'
  return chat as InboxListResult['filters']['chat']
}

function inboxApiQuery(searchParams: URLSearchParams, extra?: { msg?: number }): string {
  const qs = new URLSearchParams()
  const q = searchParams.get('q')
  if (q) qs.set('q', q)
  const chat = normalizeInboxChatParam(searchParams.get('chat'))
  if (chat !== 'all') qs.set('chat', chat)
  const windowMax = parseWindowMaxFilter(searchParams.get('window_max'))
  if (windowMax != null) qs.set('window_max', String(windowMax))
  searchParams.getAll('segment').forEach((slug) => qs.append('segment', slug))
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  if (page > 1) qs.set('page', String(page))
  if (extra?.msg) qs.set('msg', String(extra.msg))
  const value = qs.toString()
  return value ? `?${value}` : ''
}

function inboxFilterKeyFromParams(searchParams: URLSearchParams): string {
  const q = (searchParams.get('q') ?? '').trim()
  const chat = normalizeInboxChatParam(searchParams.get('chat'))
  const windowMax = parseWindowMaxFilter(searchParams.get('window_max')) ?? ''
  const segments = searchParams.getAll('segment').sort().join('\0')
  return `${q}\n${chat}\n${windowMax}\n${segments}`
}

function inboxFilterKeyFromResult(filters: InboxListResult['filters']): string {
  const segments = [...filters.segment_slugs]
  if (filters.include_none) segments.push('__none__')
  const windowMax = filters.window_max ?? ''
  return `${filters.q}\n${filters.chat}\n${windowMax}\n${segments.sort().join('\0')}`
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

function isArchivedChatFilter(
  chat: InboxListResult['filters']['chat'],
): boolean {
  return (
    chat === 'archived' ||
    chat === 'archived_auto' ||
    chat === 'archived_manual'
  )
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

/** Páginas visibles del paginador: 1, 2, 3, …, N (con vecinos del actual). */
function chatListPageItems(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const show = new Set<number>([1, total])
  for (let p = current - 1; p <= current + 1; p++) {
    if (p >= 1 && p <= total) show.add(p)
  }
  if (current <= 3) {
    show.add(2)
    show.add(3)
    show.add(4)
  }
  if (current >= total - 2) {
    show.add(total - 1)
    show.add(total - 2)
    show.add(total - 3)
  }
  const sorted = [...show].sort((a, b) => a - b)
  const out: Array<number | 'ellipsis'> = []
  let prev = 0
  for (const p of sorted) {
    if (prev > 0 && p - prev > 1) out.push('ellipsis')
    out.push(p)
    prev = p
  }
  return out
}

export function ConversationsInboxPage() {
  const { id: idParam } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const user = useAppUser()
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
  const [contactSheetPrefillName, setContactSheetPrefillName] = useState('')
  const [replyToMessage, setReplyToMessage] = useState<ReplyToMessage | null>(null)
  const [assignContext, setAssignContext] = useState<AssignContext | null>(null)
  const [assignees, setAssignees] = useState<ConversationAssignee[]>([])
  const [assigneesLoading, setAssigneesLoading] = useState(false)
  const [assignSaving, setAssignSaving] = useState(false)
  const lastMessageIdRef = useRef(0)
  const lastAuditIdRef = useRef<bigint>(BigInt(0))
  const listRequestIdRef = useRef(0)
  const listInFlightRef = useRef(false)
  const listAreaRef = useRef<string | null>(null)
  const scrollerRef = useRef<InboxMessageScrollerHandle | null>(null)
  const sendingReplyRef = useRef(false)
  const [listScrollAtEnd, setListScrollAtEnd] = useState(false)
  const [listCanScroll, setListCanScroll] = useState(false)

  const selectedId = idParam ? Number(idParam) : null
  const filterQuerySuffix = useMemo(() => {
    const sp = new URLSearchParams(searchParams)
    sp.delete('msg')
    return inboxApiQuery(sp)
  }, [searchParams])
  const searchQuery = (searchParams.get('q') ?? '').trim()
  const highlightMsgId = Number(searchParams.get('msg') || '') || null
  const chatFilter = normalizeInboxChatParam(searchParams.get('chat'))
  const windowMaxFilter = parseWindowMaxFilter(searchParams.get('window_max'))
  const selectedSegments = searchParams.getAll('segment')
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const activeFilterKey = useMemo(
    () => inboxFilterKeyFromParams(searchParams),
    [searchParams],
  )

  const loadList = useCallback((opts?: { silent?: boolean; skipIfInFlight?: boolean }) => {
    if (opts?.skipIfInFlight && listInFlightRef.current) return Promise.resolve()
    const requestId = ++listRequestIdRef.current
    listInFlightRef.current = true
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
      .finally(() => {
        if (requestId === listRequestIdRef.current) {
          listInFlightRef.current = false
        }
      })
  }, [filterQuerySuffix])

  useEffect(() => {
    const area = user?.area ?? null
    if (!area) return
    if (listAreaRef.current === null) {
      listAreaRef.current = area
      return
    }
    if (listAreaRef.current === area) return

    listAreaRef.current = area
    listRequestIdRef.current += 1
    listInFlightRef.current = false
    setList(null)
    setDetail(null)
    setSelectedContactIds(new Set())
    setBulkSegment('')
    void loadList()
  }, [loadList, user?.area])

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

  const loadDetail = useCallback((conversationId: number) => {
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
        setList((prev) => {
          if (!prev) return prev
          const item = prev.items.find((row) => row.id === conversationId)
          if (!item?.inbox_unread) return prev
          return {
            ...prev,
            unread_count: Math.max(0, (prev.unread_count ?? 0) - 1),
            items: prev.items.map((row) =>
              row.id === conversationId ? { ...row, inbox_unread: false } : row,
            ),
          }
        })
      })
  }, [])

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
            archived: result.data.conversation.archived,
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
    function tick(opts?: { forceList?: boolean }) {
      if (document.visibilityState === 'hidden') return
      void loadList({
        silent: true,
        skipIfInFlight: !opts?.forceList,
      })
      if (
        selectedId != null &&
        selectedId > 0 &&
        !sendingReplyRef.current
      ) {
        void pollConversationUpdates(selectedId)
      }
    }

    const timer = window.setInterval(() => tick(), INBOX_POLL_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'visible') tick({ forceList: true })
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
    ? (() => {
        const crmName = formatContactName(
          detail.contact?.name,
          detail.contact?.last_name,
        )
        const waAlias = String(detail.conversation.wa_profile_name ?? '').trim()
        return crmName || waAlias || detail.conversation.phone
      })()
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

  /** Abre overlays tras cerrar el ContextMenu (evita body pointer-events:none bloqueado). */
  function openAfterContextMenu(action: () => void) {
    window.setTimeout(action, 0)
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
    prefillName?: string
  }) {
    setContactSheetMode(opts.mode)
    setContactSheetContactId(opts.contactId ?? null)
    setContactSheetPhone(opts.phone)
    setContactSheetPrefillName(
      opts.mode === 'create' ? String(opts.prefillName ?? '').trim() : '',
    )
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
    if (isArchivedChatFilter(chat)) next.delete('window_max')
    setSearchParams(next)
  }

  function setWindowMaxFilter(windowMax: WindowMaxFilter) {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    if (windowMax == null) next.delete('window_max')
    else next.set('window_max', String(windowMax))
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

  function getChatListViewport(): HTMLElement | null {
    return document.querySelector(
      '.conversations-inbox-sidebar [data-radix-scroll-area-viewport]',
    )
  }

  function scrollChatListEdge() {
    const el = getChatListViewport()
    if (!el) return
    el.scrollTo({
      top: listScrollAtEnd ? 0 : el.scrollHeight,
      behavior: 'smooth',
    })
  }

  useEffect(() => {
    const viewport = getChatListViewport()
    if (!viewport) return

    function sync() {
      const el = viewport!
      const canScroll = el.scrollHeight > el.clientHeight + 8
      setListCanScroll(canScroll)
      setListScrollAtEnd(
        canScroll && el.scrollHeight - el.scrollTop - el.clientHeight < 48,
      )
    }

    sync()
    viewport.addEventListener('scroll', sync, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    ro?.observe(viewport)
    const content = viewport.firstElementChild
    if (content instanceof HTMLElement) ro?.observe(content)

    return () => {
      viewport.removeEventListener('scroll', sync)
      ro?.disconnect()
    }
  }, [list?.items.length, listPage, listPages])

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

  async function onModeChange(
    status: 'bot' | 'human',
    conversationId?: number | null,
  ) {
    const convId = conversationId ?? actionsConversationId ?? selectedId
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

  async function onMarkUnread(conversationId?: number | null) {
    const convId = conversationId ?? actionsConversationId ?? selectedId
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

  async function onSetArchived(
    archived: boolean,
    conversationId?: number | null,
  ) {
    const convId = conversationId ?? actionsConversationId ?? selectedId
    if (!convId || convId <= 0) return
    const result = await apiClient.patch<{ archived: boolean }>(
      `/api/conversations/${convId}/archive`,
      { archived },
    )
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    if (selectedId === convId) {
      if (archived || isArchivedChatFilter(chatFilter)) {
        navigate(`/conversations${filterQuerySuffix}`)
      } else {
        void loadDetail(convId)
      }
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
  const displayName = (item: InboxListItem) => {
    const crmName = String(item.contact_name ?? '').trim()
    const waAlias = String(item.wa_profile_name ?? '').trim()
    return crmName || waAlias || item.phone
  }

  if (error && !list) {
    return <p className="text-muted p-4">No se pudo cargar</p>
  }

  const filterPills = (
    <>
      {!isArchivedChatFilter(chatFilter) ? (
        <div
          className="inbox-chat-filter-pills inbox-chat-filter-pills--row inbox-chat-filter-pills--compact"
          aria-label="Filtrar lista"
        >
          {(
            [
              { key: 'all', label: 'Todos' },
              { key: 'unread', label: list?.unread_count ? `Sin leer (${list.unread_count})` : 'Sin leer' },
              { key: 'mine', label: 'Mis chats' },
              { key: 'unanswered', label: 'Sin responder' },
              { key: 'unassigned', label: 'Sin asignar' },
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant={windowMaxFilter != null ? 'default' : 'outline'}
                className="rounded-full"
                aria-label={
                  windowMaxFilter != null
                    ? `Ventana ≤${windowMaxFilter}h`
                    : 'Filtrar por horas de ventana'
                }
                title="Filtrar por horas restantes de ventana"
              >
                <WindowClockIcon />
                {windowMaxFilter != null ? `≤${windowMaxFilter}h` : null}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuLabel>Horas restantes</DropdownMenuLabel>
              <DropdownMenuItem
                onSelect={() => setWindowMaxFilter(null)}
                className={windowMaxFilter == null ? 'bg-accent-soft' : undefined}
              >
                Todas
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {WINDOW_MAX_BUCKETS.map((hours) => (
                <DropdownMenuItem
                  key={hours}
                  onSelect={() => setWindowMaxFilter(hours)}
                  className={windowMaxFilter === hours ? 'bg-accent-soft' : undefined}
                >
                  ≤{hours}h
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      ) : null}
      <div className="inbox-filters space-y-2">
        <div className="inbox-search-row">
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Buscar…"
            className="inbox-search-input"
            aria-label="Buscar en chats"
          />
          <SegmentFilterSelect
            compact
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
        </div>
      </div>
      <button
        type="button"
        className={`inbox-archived-row${isArchivedChatFilter(chatFilter) ? ' is-active' : ''}`}
        onClick={() =>
          setChatFilter(isArchivedChatFilter(chatFilter) ? 'all' : 'archived')
        }
        aria-pressed={isArchivedChatFilter(chatFilter)}
      >
        <span className="inbox-archived-row__icon" aria-hidden>
          <ArchiveChatsIcon />
        </span>
        <span className="inbox-archived-row__label">Archivados</span>
        {list?.archived_count != null ? (
          <span className="inbox-archived-row__count">{list.archived_count}</span>
        ) : null}
      </button>
      {isArchivedChatFilter(chatFilter) ? (
        <div
          className="inbox-chat-filter-pills inbox-chat-filter-pills--row inbox-chat-filter-pills--compact"
          aria-label="Filtrar archivados"
        >
          {(
            [
              { key: 'archived', label: 'Todos' },
              { key: 'archived_auto', label: 'Sin respuesta' },
              { key: 'archived_manual', label: 'Manuales' },
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
      ) : null}
      {listCount != null ? (
        <p className="px-3 text-xs text-muted">
          {listCount} chat{listCount === 1 ? '' : 's'}
          {listPages > 1 ? ` · Pág. ${listPage}/${listPages}` : null}
        </p>
      ) : null}
      {assignableSegments.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 px-3 pb-2 text-xs">
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
        className="relative conversations-inbox-sidebar"
        filters={filterPills}
        floating={
          listCanScroll ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="absolute bottom-3 right-3 z-10 size-8 rounded-full p-0 shadow-md"
              onClick={scrollChatListEdge}
              aria-label={listScrollAtEnd ? 'Ir al inicio de la lista' : 'Ir al final de la lista'}
              title={listScrollAtEnd ? 'Ir al inicio' : 'Ir al final'}
            >
              {listScrollAtEnd ? '↑' : '↓'}
            </Button>
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
              const crmName = String(item.contact_name ?? '').trim()
              const waAlias = String(item.wa_profile_name ?? '').trim()
              const name = displayName(item)
              const hasContactName = Boolean(crmName)
              const hasWaAlias = !hasContactName && Boolean(waAlias)
              const showPhoneRow = hasContactName || hasWaAlias
              const leadScore = item.contact_lead_score
              const hasConversation = !item.is_virtual
              const actionsCtx = chatActionsFromListItem(
                item,
                list.ai_area_enabled,
                name,
              )
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
              const modeStatus = String(item.conversation_status ?? '').toLowerCase()
              return (
                <ContextMenu key={item.id}>
                  <ContextMenuTrigger asChild>
                    <li
                      className={`inbox-chat-item ${item.inbox_unread ? 'inbox-chat-item--unread' : ''} ${active ? 'is-active' : ''}`}
                    >
                      {assignableSegments.length > 0 ? (
                        <label
                          className="inbox-chat-item-check"
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
                        <span className="inbox-chat-item-core">
                          <span className="inbox-chat-item-primary">
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
                              {inboxInitials(crmName || waAlias, item.phone)}
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
                                <span className="inbox-chat-title-line">
                                  <span
                                    className={`inbox-chat-title${hasWaAlias ? ' muted' : ''}`}
                                  >
                                    {name}
                                  </span>
                                  {!showPhoneRow && leadScore ? (
                                    <LeadStars score={leadScore} />
                                  ) : null}
                                </span>
                              </span>
                              {showPhoneRow ? (
                                <span className="inbox-chat-phone-row">
                                  <span className="inbox-chat-phone">{item.phone}</span>
                                  {leadScore ? <LeadStars score={leadScore} /> : null}
                                  <ConversationBadges
                                    status={item.conversation_status}
                                    assignedUserLabel={item.assigned_user_label}
                                  />
                                </span>
                              ) : (
                                <ConversationBadges
                                  status={item.conversation_status}
                                  assignedUserLabel={item.assigned_user_label}
                                />
                              )}
                              <span className="inbox-chat-row-mid">
                                <span className="inbox-chat-preview">
                                  {listPreviewText(item.preview)}
                                </span>
                              </span>
                            </span>
                          </span>
                          {item.contact_segment_slugs.length > 0 ? (
                            <span
                              className="contact-segment-chips"
                              role="group"
                              aria-label="Segmentos"
                            >
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
                            <span
                              className="inbox-unread-dot"
                              title="No leído"
                              aria-label="No leído"
                            />
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
                            openChatActions(actionsCtx)
                          }}
                        >
                          <span aria-hidden>⋮</span>
                        </button>
                      </div>
                    </li>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52">
                    <ContextMenuGroup>
                      <ContextMenuLabel className="truncate normal-case">
                        {name}
                      </ContextMenuLabel>
                      <ContextMenuItem
                        onSelect={() =>
                          openAfterContextMenu(() =>
                            openContactSheet({
                              mode: item.contact_id ? 'edit' : 'create',
                              contactId: item.contact_id,
                              phone: item.phone,
                              prefillName: waAlias,
                            }),
                          )
                        }
                      >
                        {item.contact_id ? 'Editar contacto' : 'Guardar contacto'}
                      </ContextMenuItem>
                      {hasConversation && canAssign ? (
                        <ContextMenuItem
                          onSelect={() =>
                            openAfterContextMenu(() =>
                              openAssignDialog({
                                conversationId: item.id,
                                heading: name,
                                phone: item.phone,
                                assignedUserId: item.assigned_user_id,
                              }),
                            )
                          }
                        >
                          Asignar chat
                        </ContextMenuItem>
                      ) : null}
                    </ContextMenuGroup>
                    {hasConversation ? (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuGroup>
                          {item.last_user_message_at && !item.archived ? (
                            <ContextMenuItem
                              onSelect={() => void onSetArchived(true, item.id)}
                            >
                              Archivar chat
                            </ContextMenuItem>
                          ) : null}
                          {item.archived && item.last_user_message_at ? (
                            <ContextMenuItem
                              onSelect={() => void onSetArchived(false, item.id)}
                            >
                              Desarchivar chat
                            </ContextMenuItem>
                          ) : null}
                          <ContextMenuItem
                            onSelect={() => void onMarkUnread(item.id)}
                          >
                            Marcar como no leído
                          </ContextMenuItem>
                          <ContextMenuItem
                            onSelect={() => {
                              void apiClient.download(
                                `/api/conversations/${item.id}/export`,
                              )
                            }}
                          >
                            Descargar Excel
                          </ContextMenuItem>
                        </ContextMenuGroup>
                      </>
                    ) : null}
                    {hasConversation && list.ai_area_enabled ? (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuSub>
                          <ContextMenuSubTrigger>Modo</ContextMenuSubTrigger>
                          <ContextMenuSubContent className="w-36">
                            <ContextMenuRadioGroup
                              value={
                                modeStatus === 'bot' || modeStatus === 'human'
                                  ? modeStatus
                                  : undefined
                              }
                              onValueChange={(value: string) => {
                                if (value === 'bot' || value === 'human') {
                                  void onModeChange(value, item.id)
                                }
                              }}
                            >
                              <ContextMenuRadioItem value="bot">Bot</ContextMenuRadioItem>
                              <ContextMenuRadioItem value="human">
                                Asesor
                              </ContextMenuRadioItem>
                            </ContextMenuRadioGroup>
                          </ContextMenuSubContent>
                        </ContextMenuSub>
                      </>
                    ) : null}
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() =>
                        openAfterContextMenu(() => openChatActions(actionsCtx))
                      }
                    >
                      Más opciones…
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })
          )}
          {listPages > 1 ? (
            <li className="inbox-chat-list-pager">
              <button
                type="button"
                disabled={listPage <= 1}
                onClick={() => goToPage(listPage - 1)}
                className="small-btn"
                aria-label="Página anterior"
              >
                {'<'}
              </button>
              {chatListPageItems(listPage, listPages).map((item, idx) =>
                item === 'ellipsis' ? (
                  <span key={`e-${idx}`} className="inbox-chat-list-pager-ellipsis muted">
                    …
                  </span>
                ) : (
                  <button
                    key={item}
                    type="button"
                    className={`small-btn${item === listPage ? ' primary' : ''}`}
                    aria-current={item === listPage ? 'page' : undefined}
                    onClick={() => {
                      if (item !== listPage) goToPage(item)
                    }}
                  >
                    {item}
                  </button>
                ),
              )}
              <button
                type="button"
                disabled={listPage >= listPages}
                onClick={() => goToPage(listPage + 1)}
                className="small-btn"
                aria-label="Página siguiente"
              >
                {'>'}
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
              <div className="inbox-chat-header-profile">
                <ProfileBlock
                  detail={detail}
                  segments={segments}
                  onOpenContact={() =>
                    openContactSheet({
                      mode: detail.conversation.contact_id ? 'edit' : 'create',
                      contactId: detail.conversation.contact_id,
                      phone: detail.conversation.phone,
                      prefillName: detail.conversation.wa_profile_name ?? '',
                    })
                  }
                />
              </div>
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
                ) : (
                  <InboxStartFlowMenu
                    conversationId={detail.conversation.id}
                    onStarted={() => void loadDetail(detail.conversation.id)}
                  />
                )}
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
          onMarkUnread={() => void onMarkUnread(actionsContext.conversationId)}
          onSetArchived={(archived) =>
            void onSetArchived(archived, actionsContext.conversationId)
          }
          archived={actionsContext.archived}
          lastUserMessageAt={actionsContext.lastUserMessageAt}
          onModeChange={onModeChange}
          onAssign={() => openAssignFromActions(actionsContext)}
          onOpenContact={() =>
            openContactSheet({
              mode: actionsContext.contactId ? 'edit' : 'create',
              contactId: actionsContext.contactId,
              phone: actionsContext.phone,
              prefillName: actionsContext.waProfileName,
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
        prefillName={contactSheetPrefillName}
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
