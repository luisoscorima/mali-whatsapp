import { lazy, Suspense, type FormEvent, type KeyboardEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams, Link } from 'react-router-dom'
import { useAppUser } from '@/app/appOutletContext'
import { canonicalArea, onCategorySelection, readCategorySelection } from '@/shared/area/category-selection'
import { apiClient } from '../../shared/api'
import { formatChatListTime, chatListReplyStatus } from '../../shared/format'
import { notify } from '@/shared/notify'
import {
  PERMISSION,
  userCanCreateContacts,
  userCanUpdateContacts,
  userHasPermission,
} from '@/shared/auth/permissions'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import {
  WaMainPane,
  WaMainHeader,
  WaMainFooter,
} from '@/shared/ui/shell/WaMainPane'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'
import { WaBackButton } from '@/shared/ui/shell/WaBackLink'
import { Button } from '@/shared/ui/shadcn/button'
import { formatContactName } from '../contacts/contactName'
import { type AttributeFieldDefinition } from '../contacts/contactFormUtils'
import { BulkContactActionsDialog } from '../contacts/BulkContactActionsDialog'
import { useOpenContactChat } from '../contacts/openContactChat'
import { useCategoryScope, withCategoryQuery } from '@/shared/area/useCategoryScope'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'
const ConversationsSummaryPane = lazy(() => import('./ConversationsSummaryPane').then((m) => ({ default: m.ConversationsSummaryPane })))
import { InboxComposeBar, type ReplyToMessage } from './InboxComposeBar'
import { InboxMessageScroller, type InboxMessageScrollerHandle } from './InboxMessageScroller'
import {
  chatActionsFromDetail,
  chatActionsFromListItem,
  type ChatActionsContext,
} from './inboxChatActions'
import { useAssignedInboxBrowserNotify } from './useAssignedInboxBrowserNotify'
import { chatDisplayName, chatSecondaryLabel, displayPhoneNumber, isContactPhone } from './whatsappIdentity'
import { leadScoreLabel, leadScoreTone } from './leadScore'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'

function InboxSegmentSummary({ items }: { items: Array<{ slug: string; label: string; color: string }> }) {
  const visible = 3
  return <div className="inbox-row-segments contact-segment-chips" aria-label="Segmentos">
    {items.slice(0, visible).map(item => <SegmentBadge key={item.slug} colorKey={item.color} className="inbox-chat-segment">{item.label}</SegmentBadge>)}
    {items.length > visible ? <Popover><PopoverTrigger asChild>
      <button type="button" className="inbox-filter-chip" aria-label={'Ver los ' + items.length + ' segmentos'}>+{items.length - visible}</button>
    </PopoverTrigger><PopoverContent align="start" className="w-64 max-h-64 overflow-y-auto">
      <p className="mb-2 text-sm font-medium">Todos los segmentos</p>
      <div className="contact-segment-chips">{items.map(item => <SegmentBadge key={item.slug} colorKey={item.color}>{item.label}</SegmentBadge>)}</div>
    </PopoverContent></Popover> : null}
  </div>
}

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

function InboxNotifyBellIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={active ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

function InboxNotifyBellOffIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M8.7 3A6 6 0 0 1 18 8c0 2.2.4 4 1.1 5.4" />
      <path d="M17 17H3s3-2 3-9a6 6 0 0 1 .3-1.9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      <line x1="2" y1="2" x2="22" y2="22" />
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

function LeadScoreBadge({ score }: { score: number }) {
  const label = leadScoreLabel(score)
  const tone = leadScoreTone(score)
  if (!label || !tone) return null
  return (
    <span
      className={`inbox-lead-score-badge inbox-lead-score-badge--${tone}`}
      title="Calificación del lead"
    >
      {label}
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

function InboxWhatsAppIcon({ size = 13 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M20.5 3.5A11.8 11.8 0 0 0 2 17.7L.4 23.6l6-1.6A11.8 11.8 0 0 0 20.5 3.5ZM12 21.4a9.7 9.7 0 0 1-5-1.4l-.4-.2-3.6.9 1-3.5-.3-.4A9.8 9.8 0 1 1 12 21.4Zm5.4-7.3c-.3-.2-1.7-.8-2-.9-.2-.1-.4-.2-.6.1l-.9 1.1c-.2.2-.3.2-.6.1a8 8 0 0 1-3.9-3.4c-.3-.5.3-.4.9-1.6.1-.2 0-.4 0-.6l-.9-2.1c-.2-.5-.5-.4-.7-.4H7.9c-.2 0-.5.1-.7.3-.3.3-1 1-1 2.4s1 2.7 1.2 2.9c.1.2 2 3.1 4.9 4.4 1.8.8 2.5.9 3.4.8.5-.1 1.7-.7 1.9-1.4.2-.7.2-1.3.1-1.4l-.3-.3Z" />
    </svg>
  )
}

function InboxHeaderAssigneeIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="7" r="4" />
      <path d="M5.5 21a6.5 6.5 0 0 1 13 0" />
    </svg>
  )
}

function InboxHeaderLockIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      <circle cx="12" cy="15.5" r="1" />
    </svg>
  )
}

function inboxTeamLabel(lineProgram: string | null | undefined): string | null {
  const value = String(lineProgram ?? '').trim()
  if (!value) return null
  const canonical = canonicalArea(value.toLowerCase())
  const label = canonical
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
  return label ? `Equipo ${label}` : null
}

function ProfileBlock({
  detail,
  segments,
  onOpenContact,
  onBack,
  actions,
}: {
  detail: InboxDetail
  segments: SegmentOption[]
  onOpenContact: () => void
  onBack?: () => void
  actions?: ReactNode
}) {
  const user = useAppUser()
  const canManageLeads = Boolean(user?.canManageLeads)
  const contactId = detail.conversation.contact_id
  const contactMode = contactId ? 'edit' : 'create'
  const contactActionLabel = contactId ? 'Editar contacto' : 'Añadir contacto'
  const canOpenContact = contactId
    ? userCanUpdateContacts(user)
    : userCanCreateContacts(user)
  const crmName = formatContactName(
    detail.contact?.name,
    detail.contact?.last_name,
  )
  const waAlias = String(detail.conversation.wa_profile_name ?? '').trim()
  const isWaAlias = !crmName && Boolean(waAlias || detail.conversation.wa_username)
  const heading = chatDisplayName({
    phone: detail.conversation.phone,
    contactName: crmName,
    profileName: waAlias,
    username: detail.conversation.wa_username,
  })
  const leadScore = detail.contact?.lead_score
  const leadStatusLabel = detail.contact?.lead_status?.label
  const lineName = detail.conversation.line_label
    || detail.conversation.line_program?.toUpperCase()
    || (detail.conversation.line_display_phone ? 'Línea de WhatsApp' : null)
  const assigneeName = detail.conversation.assigned_user_label?.trim() || 'Sin asignar'
  const teamLabel = inboxTeamLabel(detail.conversation.line_program)
  return (
    <div className="inbox-chat-header-summary">
      <section className="inbox-chat-header-customer-panel" aria-label="Cliente">
        {onBack ? (
          <WaBackButton onClick={onBack} label="Volver a chats" mobileOnly />
        ) : null}
        <span className="inbox-chat-avatar inbox-chat-avatar--header" aria-hidden>
          {inboxInitials(heading, detail.conversation.phone)}
        </span>
        <div className="inbox-chat-header-identity">
          <span
            className={`inbox-chat-window-pill ${detail.user_service_window_open ? 'is-open' : 'is-closed'}`}
            title={
              detail.user_service_window_open
                ? 'Ventana de servicio abierta'
                : 'Ventana de servicio cerrada'
            }
          >
            {detail.user_service_window_open ? <WindowClockIcon /> : <InboxHeaderLockIcon />}
            {detail.user_service_window_open ? 'Abierta' : 'Cerrada'}
          </span>
          <div className="inbox-chat-header-customer">
            <div className="inbox-chat-heading-row">
              <h1 className={`inbox-chat-heading${isWaAlias ? ' muted' : ''}`}>
                {heading}
              </h1>
              {canOpenContact ? (
                <button
                  type="button"
                  className="inbox-chat-contact-icon-btn"
                  title={contactActionLabel}
                  aria-label={contactActionLabel}
                  onClick={onOpenContact}
                >
                  <ContactSheetIcon mode={contactMode} />
                </button>
              ) : null}
            </div>
            <p className="inbox-chat-person-phone">
              {chatSecondaryLabel(detail.conversation.phone)}
            </p>
          </div>
        </div>
        {actions ? (
          <div className="inbox-chat-header-toolbar">{actions}</div>
        ) : null}
      </section>

      <section className="inbox-chat-header-context" aria-label="Línea de atención">
        <span className="inbox-chat-header-context-icon">
          <InboxWhatsAppIcon size={20} />
        </span>
        <span className="inbox-chat-header-context-copy">
          <span className="inbox-chat-header-context-label">Línea de atención</span>
          <span className="inbox-chat-header-context-value">{lineName || 'Sin línea'}</span>
          {detail.conversation.line_display_phone ? (
            <span className="inbox-chat-header-context-detail">
              {displayPhoneNumber(detail.conversation.line_display_phone)}
            </span>
          ) : null}
        </span>
      </section>

      <section className="inbox-chat-header-context" aria-label="Asesor asignado">
        <span className="inbox-chat-header-context-icon">
          <InboxHeaderAssigneeIcon />
        </span>
        <span className="inbox-chat-header-context-copy">
          <span className="inbox-chat-header-context-label">Asesor asignado</span>
          <span className="inbox-chat-header-context-value">{assigneeName}</span>
          {teamLabel ? (
            <span className="inbox-chat-header-context-detail">{teamLabel}</span>
          ) : null}
        </span>
      </section>

      <div className="inbox-chat-header-meta">
        <ConversationBadges
          status={detail.conversation.status}
          assignedUserLabel={detail.conversation.assigned_user_label}
          hideAssignee
          archived={Boolean(detail.conversation.archived)}
          unanswered={!detail.conversation.last_user_message_at}
        />
        {leadScore || leadStatusLabel ? (
          <p className="inbox-chat-lead-meta">
            {leadScore ? (
              <LeadScoreBadge score={leadScore} />
            ) : null}
            {leadStatusLabel ? (
              <span>{leadStatusLabel}</span>
            ) : null}
          </p>
        ) : null}
        {detail.meta_ad ? (
          <p className="inbox-chat-sub muted">
            Anuncio:{' '}
            {canManageLeads ? (
              <Link to={`/leads/meta-ctwa/${detail.meta_ad.id}`}>
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
      </div>
    </div>
  )
}


type SegmentOption = {
  id?: number
  category?: string
  slug: string
  label: string
  color_key: string
  assignment_group?: string | null
}

type InboxListItem = {
  id: number
  phone: string | null
  whatsapp_user_id: string | null
  recipient: string
  last_message_at: string | null
  unread_message_count?: number | null
  inbox_unread: boolean
  conversation_status: string | null
  assigned_user_id: number | null
  assigned_user_label: string | null
  automation_touched_at: string | null
  contact_name: string
  wa_profile_name: string | null
  wa_username: string | null
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
  line_label?: string | null
  line_display_phone?: string | null
  line_program?: string | null
}

type InboxListResult = {
  items: InboxListItem[]
  total_count: number
  total_exact?: boolean
  page: number
  pages: number
  unread_count: number
  archived_count: number
  ai_area_enabled: boolean
  can_assign_conversations: boolean
  segments: SegmentOption[]
  assignable_segments: SegmentOption[]
  categories: Array<{ slug: string; label: string }>
  filters: {
    q: string
    qm: boolean
    chat: 'all' | 'unread' | 'bot' | 'human' | 'mine' | 'unassigned' | 'unanswered' | 'archived' | 'archived_auto' | 'archived_manual'
    window_max: WindowMaxFilter
    from: string | null
    to: string | null
    range: 'default' | 'all' | 'custom'
    applied_from: string | null
    applied_to: string | null
    segment_slugs: string[]
    include_none: boolean
    categories: string[]
    line_id: number | null
  }
}

type InboxLineOption = {
  id: number
  label: string
  phone: string | null
  category: string
  category_label: string
}

const BULK_NATIVE_ATTR_SLUGS = new Set(['dni', 'email', 'correo'])

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
  interactive_buttons?: { id: string; title: string }[]
}

type InboxDetail = {
  conversation: {
    id: number
    phone: string | null
    whatsapp_user_id: string | null
    recipient: string
    status: string
    last_message_at: string | null
    last_user_message_at?: string | null
    inbox_unread: boolean
    archived?: boolean
    contact_id: number | null
    wa_profile_name: string | null
    wa_username: string | null
    assigned_user_id: number | null
    assigned_user_label: string | null
    automation_touched_at: string | null
    line_label?: string | null
    line_display_phone?: string | null
    line_program?: string | null
  }
  contact: {
    name: string | null
    last_name: string | null
    phone: string
    email: string | null
    dni: string | null
    lead_score: number | null
    lead_status: { id: number; slug: string; label: string } | null
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
  has_older_messages?: boolean
  has_newer_messages?: boolean
  can_reply: boolean
  reply_blocked_reason: '24h' | 'bot_mode' | null
  user_service_window_open: boolean
  ai_area_enabled: boolean
  can_assign_conversations: boolean
}

type InboxOlderMessagesResult = {
  messages: InboxMessage[]
  events: InboxTimelineEvent[]
  has_older_messages: boolean
  has_newer_messages: boolean
}

type InboxConversationUpdates = {
  messages: InboxMessage[]
  has_newer_messages: boolean
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

function isYmdDateParam(raw: string | null): raw is string {
  return Boolean(raw && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim()))
}

function inboxSearchMessagesParam(searchParams: URLSearchParams): boolean {
  const raw = (searchParams.get('qm') ?? '').trim().toLowerCase()
  return raw === '1' || raw === 'true' || raw === 'yes'
}

/** Alineado con API: 4 chars texto / 3 dígitos teléfono. */
function inboxSearchMayScanMessages(q: string, qm: boolean): boolean {
  if (!qm) return false
  const trimmed = q.trim()
  if (!trimmed) return false
  const digitsOnly = trimmed.replace(/\D/g, '')
  const compact = trimmed.replace(/[\s\-()+]/g, '')
  if (digitsOnly.length > 0 && compact === digitsOnly) return digitsOnly.length >= 3
  return trimmed.length >= 4
}

function inboxApiQuery(searchParams: URLSearchParams, extra?: { msg?: number }): string {
  const qs = new URLSearchParams()
  const q = searchParams.get('q')
  if (q) qs.set('q', q)
  if (q && inboxSearchMessagesParam(searchParams)) qs.set('qm', '1')
  const chat = normalizeInboxChatParam(searchParams.get('chat'))
  if (chat !== 'all') qs.set('chat', chat)
  const windowMax = parseWindowMaxFilter(searchParams.get('window_max'))
  if (windowMax != null) qs.set('window_max', String(windowMax))
  const from = searchParams.get('from')
  const to = searchParams.get('to')
  const hasFrom = isYmdDateParam(from)
  const hasTo = isYmdDateParam(to)
  if (hasFrom) qs.set('from', from.trim())
  if (hasTo) qs.set('to', to.trim())
  if (!hasFrom && !hasTo && searchParams.get('range') === 'all') qs.set('range', 'all')
  searchParams.getAll('segment').forEach((slug) => qs.append('segment', slug))
  searchParams.getAll('category').forEach((slug) => qs.append('category', slug))
  const line = Number(searchParams.get('line') ?? '')
  if (Number.isInteger(line) && line > 0) qs.set('line', String(line))
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  if (page > 1) qs.set('page', String(page))
  if (extra?.msg) qs.set('msg', String(extra.msg))
  const value = qs.toString()
  return value ? `?${value}` : ''
}

function parseInboxLineParam(raw: string | null): number | null {
  const n = Number(raw ?? '')
  if (!Number.isInteger(n) || n <= 0) return null
  return n
}

function inboxLineLabel(line: InboxLineOption): string {
  const parts = [line.label]
  if (line.phone) parts.push(line.phone)
  return parts.filter(Boolean).join(' · ') || 'Línea'
}

function inboxDateKeyFromParams(searchParams: URLSearchParams): string {
  const from = isYmdDateParam(searchParams.get('from'))
    ? searchParams.get('from')!.trim()
    : ''
  const to = isYmdDateParam(searchParams.get('to'))
    ? searchParams.get('to')!.trim()
    : ''
  if (from || to) return `custom\n${from}\n${to}`
  if (searchParams.get('range') === 'all') return 'all'
  return 'default'
}

function inboxDateKeyFromResult(filters: InboxListResult['filters']): string {
  if (filters.range === 'custom') {
    return `custom\n${filters.from ?? ''}\n${filters.to ?? ''}`
  }
  if (filters.range === 'all') return 'all'
  return 'default'
}

function inboxFilterKeyFromParams(searchParams: URLSearchParams): string {
  const q = (searchParams.get('q') ?? '').trim()
  const qm = q && inboxSearchMessagesParam(searchParams) ? '1' : ''
  const chat = normalizeInboxChatParam(searchParams.get('chat'))
  const windowMax = parseWindowMaxFilter(searchParams.get('window_max')) ?? ''
  const line = parseInboxLineParam(searchParams.get('line')) ?? ''
  const segments = searchParams.getAll('segment').sort().join('\0')
  return `${q}\n${qm}\n${chat}\n${windowMax}\n${line}\n${inboxDateKeyFromParams(searchParams)}\n${segments}`
}

function inboxFilterKeyFromResult(filters: InboxListResult['filters']): string {
  const segments = [...filters.segment_slugs]
  if (filters.include_none) segments.push('__none__')
  const windowMax = filters.window_max ?? ''
  const line = filters.line_id ?? ''
  const qm = filters.q && filters.qm ? '1' : ''
  return `${filters.q}\n${qm}\n${filters.chat}\n${windowMax}\n${line}\n${inboxDateKeyFromResult(filters)}\n${segments.sort().join('\0')}`
}

function inboxInitials(contactName: string, phone: string | null): string {
  const name = contactName.trim()
  if (!phone && name === 'Usuario de WhatsApp') return 'WA'
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean)
    if (parts.length >= 2) {
      return (parts[0].charAt(0) + parts[1].charAt(0)).toUpperCase().slice(0, 2)
    }
    return name.slice(0, 2).toUpperCase()
  }
  if (!phone) return 'WA'
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

/** Páginas visibles del paginador: 1, 2, 3, …, N (con vecinos del actual). */
function chatListPageItems(current: number, total: number): Array<number | 'ellipsis'> {
  if (total <= 5) {
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

type ServiceReplyLine = {
  id: number
  category?: string | null
  category_label?: string | null
  label: string
  replyCount: number
  freeAllowance: number
  billableCount: number
  usdAmount: number
  penAmount: number
}

type ServiceReplyQuota = {
  monthLabel: string
  lines: ServiceReplyLine[]
}

type ServiceReplyGroup = {
  key: string
  title: string
  lines: ServiceReplyLine[]
}

function serviceReplyMonthTitle(label: string): string {
  if (!label) return 'Referencial'
  return `${label.charAt(0).toUpperCase()}${label.slice(1)} · referencial`
}

function serviceReplyNote(line: ServiceReplyLine): string {
  if (line.billableCount <= 0) return `de ${line.freeAllowance.toLocaleString('es-PE')}`
  const extra = line.billableCount.toLocaleString('es-PE')
  const soles = line.penAmount.toLocaleString('es-PE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${extra} de más · S/ ${soles}`
}

function groupServiceReplyLines(lines: ServiceReplyLine[]): ServiceReplyGroup[] | null {
  if (!lines.some((line) => line.category_label)) return null
  const order: string[] = []
  const map = new Map<string, ServiceReplyGroup>()
  for (const line of lines) {
    const key = line.category || line.category_label || ''
    const title = line.category_label || 'General'
    let group = map.get(key)
    if (!group) {
      group = { key, title, lines: [] }
      map.set(key, group)
      order.push(key)
    }
    group.lines.push(line)
  }
  return order.map((key) => map.get(key)!)
}

function ServiceReplyLineRow({
  line,
  bordered,
  fallbackLabel,
}: {
  line: ServiceReplyLine
  bordered?: boolean
  fallbackLabel: string
}) {
  return (
    <li
      className={`flex items-baseline justify-between gap-3 px-3 py-2${bordered ? ' border-t border-line' : ''}`}
    >
      <span className="min-w-0 text-sm">{line.label || fallbackLabel}</span>
      <span className="shrink-0 text-right">
        <span className="block text-sm tabular-nums">{line.replyCount.toLocaleString('es-PE')}</span>
        <span className="block text-xs text-muted">{serviceReplyNote(line)}</span>
      </span>
    </li>
  )
}

function ServiceReplyQuotaList({ lines }: { lines: ServiceReplyLine[] }) {
  const groups = groupServiceReplyLines(lines)
  if (!groups) {
    return (
      <ul>
        {lines.map((line, index) => (
          <ServiceReplyLineRow
            key={`${line.id}-${line.label}`}
            line={line}
            bordered={index > 0}
            fallbackLabel="Respuestas"
          />
        ))}
      </ul>
    )
  }
  return (
    <ul>
      {groups.map((group, groupIndex) => (
        <li key={group.key} className={groupIndex > 0 ? 'border-t border-line' : undefined}>
          <p className="px-3 pt-2.5 pb-1 text-xs font-medium text-muted">{group.title}</p>
          <ul>
            {group.lines.map((line) => (
              <ServiceReplyLineRow
                key={`${line.id}-${line.label}`}
                line={line}
                fallbackLabel="Línea"
              />
            ))}
          </ul>
        </li>
      ))}
    </ul>
  )
}

export function ConversationsInboxPage() {
  const { id: idParam } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const user = useAppUser()
  const canSendTemplate = userHasPermission(user, PERMISSION.TEMPLATES_SEND_FROM_CHAT)
  const { confirm, confirmDialog } = useConfirmDialog()
  const categoryScope = useCategoryScope()
  const { openContactChat, linePickerDialog } = useOpenContactChat({
    categoryQuery: categoryScope.query,
  })
  const openContactChatRef = useRef(openContactChat)
  openContactChatRef.current = openContactChat
  const [list, setList] = useState<InboxListResult | null>(null)
  const [inboxLines, setInboxLines] = useState<InboxLineOption[]>([])
  const [serviceReplies, setServiceReplies] = useState<ServiceReplyQuota | null>(null)
  const [detail, setDetail] = useState<InboxDetail | null>(null)
  const [error, setError] = useState('')
  const [replyText, setReplyText] = useState('')
  const [replyFile, setReplyFile] = useState<File | null>(null)
  const [sendingReply, setSendingReply] = useState(false)
  const [searchInput, setSearchInput] = useState(searchParams.get('q') ?? '')
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [loadingMessagePage, setLoadingMessagePage] = useState(false)
  const [selectedContactIds, setSelectedContactIds] = useState<Set<number>>(new Set())
  const [bulkAttrDefs, setBulkAttrDefs] = useState<AttributeFieldDefinition[]>([])
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkActionsOpen, setBulkActionsOpen] = useState(false)
  const [actionsOpen, setActionsOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [actionsContext, setActionsContext] = useState<ChatActionsContext | null>(null)
  const [contactSheetOpen, setContactSheetOpen] = useState(false)
  const [contactSheetMode, setContactSheetMode] = useState<'edit' | 'create'>('edit')
  const [contactSheetContactId, setContactSheetContactId] = useState<number | null>(null)
  const [contactSheetPhone, setContactSheetPhone] = useState('')
  const [contactSheetUserId, setContactSheetUserId] = useState<string | null>(null)
  const [contactSheetPrefillName, setContactSheetPrefillName] = useState('')
  const [replyToMessage, setReplyToMessage] = useState<ReplyToMessage | null>(null)
  const [contactAttributes, setContactAttributes] = useState<Record<string, string>>({})
  const [assignContext, setAssignContext] = useState<AssignContext | null>(null)
  const [assignees, setAssignees] = useState<ConversationAssignee[]>([])
  const [assigneesLoading, setAssigneesLoading] = useState(false)
  const [assignSaving, setAssignSaving] = useState(false)
  const lastMessageIdRef = useRef(0)
  const lastAuditIdRef = useRef<bigint>(BigInt(0))
  const listRequestIdRef = useRef(0)
  const detailRequestIdRef = useRef(0)
  const listInFlightRef = useRef(false)
  const listAbortRef = useRef<AbortController | null>(null)
  const quotaRequestIdRef = useRef(0)
  const listAreaRef = useRef<string | null>(null)
  const scrollerRef = useRef<InboxMessageScrollerHandle | null>(null)
  const sendingReplyRef = useRef(false)
  const detailAbortRef = useRef<AbortController | null>(null)
  const pageAbortRef = useRef<AbortController | null>(null)
  const updatesAbortRef = useRef<AbortController | null>(null)
  const detailRef = useRef(detail)
  detailRef.current = detail
  const searchParamsRef = useRef(searchParams)
  searchParamsRef.current = searchParams
  const [showSummary, setShowSummary] = useState(false)
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
  const lineFilter = parseInboxLineParam(searchParams.get('line'))
  const explicitFrom = isYmdDateParam(searchParams.get('from'))
    ? searchParams.get('from')!.trim()
    : ''
  const explicitTo = isYmdDateParam(searchParams.get('to'))
    ? searchParams.get('to')!.trim()
    : ''
  const rangeAll = searchParams.get('range') === 'all'
  const selectedSegments = searchParams.getAll('segment')
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const activeFilterKey = useMemo(
    () => inboxFilterKeyFromParams(searchParams),
    [searchParams],
  )

  useEffect(() => {
    if (!user || canonicalArea(user.area) !== 'educacion') return
    const apply = () => {
      const stored = readCategorySelection(user.id, user.area)
      const current = [...searchParamsRef.current.getAll('category')].sort().join('\0')
      const wanted = stored ? [...stored].sort().join('\0') : ''
      if (current === wanted) return
      const next = new URLSearchParams(searchParamsRef.current)
      next.delete('category')
      next.delete('segment')
      next.delete('page')
      if (stored) stored.forEach((slug) => next.append('category', slug))
      setSearchParams(next, { replace: true })
    }
    apply()
    return onCategorySelection(apply)
  }, [user, setSearchParams])

  const loadList = useCallback((opts?: { silent?: boolean; skipIfInFlight?: boolean }) => {
    if (opts?.skipIfInFlight && listInFlightRef.current) return Promise.resolve()
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
    const requestId = ++listRequestIdRef.current
    listInFlightRef.current = true
    return apiClient
      .get<InboxListResult>(`/api/conversations${filterQuerySuffix}`, { signal: controller.signal })
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
      .catch(() => {
        if (!controller.signal.aborted && !opts?.silent) setError('No se pudo cargar la bandeja. Intenta de nuevo.')
      })
      .finally(() => {
        if (requestId === listRequestIdRef.current) {
          listInFlightRef.current = false
        }
      })
  }, [filterQuerySuffix])

  const serviceReplyCategoryKey = searchParams.getAll('category').slice().sort().join('\0')

  const loadServiceReplies = useCallback(async () => {
    const requestId = ++quotaRequestIdRef.current
    const qs = new URLSearchParams()
    if (serviceReplyCategoryKey) {
      serviceReplyCategoryKey.split('\0').forEach((slug) => qs.append('category', slug))
    }
    const suffix = qs.toString()
    try {
      const result = await apiClient.get<ServiceReplyQuota>(
        `/api/conversations/service-replies${suffix ? `?${suffix}` : ''}`,
      )
      if (requestId !== quotaRequestIdRef.current) return
      if (result.ok) setServiceReplies(result.data)
    } catch {
      // Se vuelve a consultar al enviar o en el próximo ciclo.
    }
  }, [serviceReplyCategoryKey])

  useEffect(() => {
    setServiceReplies(null)
    void loadServiceReplies()
  }, [loadServiceReplies, user?.area])

  useEffect(() => {
    let cancelled = false
    void apiClient
      .get<InboxLineOption[]>(
        withCategoryQuery('/api/conversations/open-lines', categoryScope.query),
      )
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setInboxLines([])
          return
        }
        setInboxLines(result.data)
      })
      .catch(() => {
        if (!cancelled) setInboxLines([])
      })
    return () => {
      cancelled = true
    }
  }, [categoryScope.query, user?.area])

  useEffect(() => {
    if (lineFilter == null) return
    if (!inboxLines.length) return
    if (inboxLines.some((line) => line.id === lineFilter)) return
    const next = new URLSearchParams(searchParamsRef.current)
    next.delete('line')
    next.delete('page')
    setSearchParams(next, { replace: true })
  }, [inboxLines, lineFilter, setSearchParams])

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
    void loadList()
  }, [loadList, user?.area])

  useEffect(() => {
    setSelectedContactIds(new Set())
  }, [filterQuerySuffix])

  useEffect(() => {
    if (!user?.area || !bulkActionsOpen) return
    apiClient
      .get<{ attribute_definitions: AttributeFieldDefinition[] }>(
        '/api/contacts/filter-options',
      )
      .then((res) => {
        if (!res.ok) return
        const bySlug = new Map<string, AttributeFieldDefinition>()
        for (const def of res.data.attribute_definitions ?? []) {
          if (BULK_NATIVE_ATTR_SLUGS.has(def.slug)) continue
          const prev = bySlug.get(def.slug)
          if (!prev || !def.segment_slug) bySlug.set(def.slug, def)
        }
        setBulkAttrDefs(
          [...bySlug.values()].sort((a, b) => a.label.localeCompare(b.label)),
        )
      })
  }, [user?.area, bulkActionsOpen])

  const listMatchesFilters =
    list != null && inboxFilterKeyFromResult(list.filters) === activeFilterKey

  const listCount = useMemo(() => {
    if (!list || !listMatchesFilters) return null
    const n = list.total_count ?? list.items.length
    if (list.total_exact === false) return `${n}${list.pages > list.page ? '+' : ''}`
    return n
  }, [list, listMatchesFilters])

  const listPages = useMemo(() => {
    if (!list || !listMatchesFilters) return 0
    return list.pages
  }, [list, listMatchesFilters])

  const listPage =
    list && listMatchesFilters ? list.page : page

  const listBusy = list != null && !listMatchesFilters
  const showStaleList = listBusy && (list?.items.length ?? 0) > 0

  const showingDefaultRange = !rangeAll && !explicitFrom && !explicitTo && !searchQuery
  const dateFromFilter =
    explicitFrom ||
    (showingDefaultRange && listMatchesFilters ? (list?.filters.applied_from ?? '') : '')
  const dateToFilter =
    explicitTo ||
    (showingDefaultRange && listMatchesFilters ? (list?.filters.applied_to ?? '') : '')

  const hasActiveListFilters =
    chatFilter !== 'all' ||
    windowMaxFilter != null ||
    lineFilter != null ||
    selectedSegments.length > 0 ||
    Boolean(searchQuery) ||
    Boolean(explicitFrom) ||
    Boolean(explicitTo) ||
    rangeAll

  function clearListFilters() {
    const next = new URLSearchParams(searchParams)
    for (const key of ['q', 'qm', 'chat', 'window_max', 'line', 'from', 'to', 'range', 'segment', 'page', 'msg']) next.delete(key)
    setSearchInput('')
    setSearchParams(next)
  }

  const loadDetail = useCallback(
    (conversationId: number, messageId?: number | null) => {
      detailAbortRef.current?.abort()
      pageAbortRef.current?.abort()
      pageAbortRef.current = null
      updatesAbortRef.current?.abort()
      const controller = new AbortController()
      detailAbortRef.current = controller
      const requestId = ++detailRequestIdRef.current
      setLoadingDetail(true)
      setLoadingMessagePage(false)
      setError('')
      return apiClient
        .get<InboxDetail>(
          `/api/conversations/${conversationId}${messageId ? `?message_id=${messageId}` : ''}`,
          { signal: controller.signal },
        )
        .then((result) => {
          if (requestId !== detailRequestIdRef.current) return
          setLoadingDetail(false)
          if (!result.ok) {
            notify.error(result.error)
            setError(result.error)
            setDetail(null)
            setContactAttributes({})
            return
          }
          setDetail(result.data)
          if (!messageId)
            requestAnimationFrame(() => {
              if (requestId === detailRequestIdRef.current)
                scrollerRef.current?.scrollToBottom('auto')
            })
          const cid = result.data.conversation.contact_id
          if (cid) {
            apiClient
              .get<{ attributes: Record<string, string> }>(
                `/api/contacts/${cid}`,
                { signal: controller.signal },
              )
              .then((cr) => {
                if (requestId !== detailRequestIdRef.current) return
                if (cr.ok) setContactAttributes(cr.data.attributes || {})
                else setContactAttributes({})
              })
              .catch(() => {})
          } else {
            setContactAttributes({})
          }
          setList((prev) => {
            if (!prev) return prev
            const item = prev.items.find((row) => row.id === conversationId)
            if (!item?.inbox_unread) return prev
            return {
              ...prev,
              unread_count: Math.max(0, (prev.unread_count ?? 0) - 1),
              items: prev.items.map((row) =>
                row.id === conversationId
                  ? { ...row, inbox_unread: false }
                  : row,
              ),
            }
          })
        })
        .catch(() => {
          if (
            !controller.signal.aborted &&
            requestId === detailRequestIdRef.current
          ) {
            setError('No se pudo cargar la conversación. Intenta de nuevo.')
            setLoadingDetail(false)
          }
        })
        .finally(() => {
          if (detailAbortRef.current === controller)
            detailAbortRef.current = null
        })
    },
    [],
  )

  const loadMessagePage = useCallback(async (direction: 'before' | 'after') => {
    const current = detailRef.current
    if (!current || pageAbortRef.current || detailAbortRef.current) return
    if (
      direction === 'before'
        ? !current.has_older_messages
        : !current.has_newer_messages
    )
      return
    const cursor =
      direction === 'before'
        ? current.messages[0]?.id
        : current.messages.at(-1)?.id
    if (!cursor) return
    const conversationId = current.conversation.id
    const requestId = detailRequestIdRef.current
    const controller = new AbortController()
    pageAbortRef.current = controller
    setLoadingMessagePage(true)
    try {
      const result = await apiClient.get<InboxOlderMessagesResult>(
        `/api/conversations/${conversationId}/messages?${direction}_id=${cursor}`,
        { signal: controller.signal },
      )
      if (controller.signal.aborted || requestId !== detailRequestIdRef.current)
        return
      if (!result.ok) {
        notify.error(result.error)
        return
      }
      if (direction === 'before') scrollerRef.current?.preserveScrollOnPrepend()
      setDetail((prev) => {
        if (!prev || prev.conversation.id !== conversationId) return prev
        const known = new Set(prev.messages.map((m) => m.id))
        const incoming = result.data.messages.filter((m) => !known.has(m.id))
        return {
          ...prev,
          messages: [...prev.messages, ...incoming].sort((a, b) => a.id - b.id),
          events: mergeTimelineEvents(prev.events, result.data.events ?? []),
          ...(direction === 'before'
            ? { has_older_messages: result.data.has_older_messages }
            : { has_newer_messages: result.data.has_newer_messages }),
        }
      })
    } catch {
      if (!controller.signal.aborted)
        notify.error('No se pudieron cargar los mensajes. Intenta de nuevo.')
    } finally {
      if (pageAbortRef.current === controller) {
        pageAbortRef.current = null
        setLoadingMessagePage(false)
      }
    }
  }, [])

  const conversationPath = useCallback(
    (conversationId: number, item?: InboxListItem): string => {
      return `/conversations/${conversationId}${inboxApiQuery(searchParamsRef.current, {
        msg: item?.matched_message_id ?? undefined,
      })}`
    },
    [],
  )

  const openConversationFromNotify = useCallback(
    (conversationId: number) => {
      navigate(conversationPath(conversationId))
    },
    [navigate, conversationPath],
  )

  const {
    permission: browserNotifyPermission,
    active: browserNotifyActive,
    enable: enableBrowserNotify,
    disable: disableBrowserNotify,
    supported: browserNotifySupported,
  } = useAssignedInboxBrowserNotify({
    userId: user?.id,
    selectedConversationId: selectedId != null && selectedId > 0 ? selectedId : null,
    onOpenConversation: openConversationFromNotify,
  })

  const pollConversationUpdates = useCallback(
    async (conversationId: number) => {
      const current = detailRef.current
      if (
        !current ||
        current.conversation.id !== conversationId ||
        current.has_newer_messages ||
        detailAbortRef.current ||
        pageAbortRef.current ||
        updatesAbortRef.current
      )
        return
      const controller = new AbortController()
      updatesAbortRef.current = controller
      const requestId = detailRequestIdRef.current
      try {
        const afterId = lastMessageIdRef.current
        const afterAuditId = lastAuditIdRef.current
        const result = await apiClient.get<InboxConversationUpdates>(
          `/api/conversations/${conversationId}/updates?after_message_id=${afterId}&after_audit_id=${afterAuditId.toString()}&visible_from_id=${current.messages[0]?.id ?? 0}`,
          { signal: controller.signal },
        )
        if (
          !result.ok ||
          controller.signal.aborted ||
          requestId !== detailRequestIdRef.current
        )
          return

        const shouldScroll = scrollerRef.current?.isNearBottom() ?? true
        const incoming = result.data.messages
        const reactionPatches = result.data.message_reactions ?? []
        const deliveryPatches = result.data.message_deliveries ?? []
        const incomingEvents = result.data.events ?? []

        setDetail((prev) => {
          if (!prev || prev.conversation.id !== conversationId) return prev
          const known = new Set(prev.messages.map((message) => message.id))
          const merged = [...prev.messages]
          for (const message of incoming) {
            if (!known.has(message.id)) merged.push(message)
          }
          merged.sort((a, b) => a.id - b.id)
          return {
            ...prev,
            has_newer_messages: result.data.has_newer_messages,
            messages: mergeMessageDeliveries(
              mergeMessageReactions(merged, reactionPatches),
              deliveryPatches,
            ),
            events: mergeTimelineEvents(prev.events ?? [], incomingEvents),
            conversation: {
              ...prev.conversation,
              status: result.data.conversation.status,
              last_message_at: result.data.conversation.last_message_at,
              last_user_message_at:
                result.data.conversation.last_user_message_at,
              inbox_unread: result.data.conversation.inbox_unread,
              archived: result.data.conversation.archived,
              assigned_user_id: result.data.conversation.assigned_user_id,
              assigned_user_label: result.data.conversation.assigned_user_label,
              automation_touched_at:
                result.data.conversation.automation_touched_at,
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
            requestAnimationFrame(() =>
              scrollerRef.current?.scrollToBottom('auto'),
            )
          }
        } else if (
          (reactionPatches.length > 0 || incomingEvents.length > 0) &&
          shouldScroll
        ) {
          requestAnimationFrame(() =>
            scrollerRef.current?.scrollToBottom('auto'),
          )
        }

        if (incomingEvents.length > 0) {
          const nextAudit = maxAuditId(incomingEvents)
          if (nextAudit > lastAuditIdRef.current) {
            lastAuditIdRef.current = nextAudit
          }
        }
      } catch {
        // Reintentar en el próximo ciclo, sin superponer solicitudes.
      } finally {
        if (updatesAbortRef.current === controller)
          updatesAbortRef.current = null
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
    let lastListPoll = Date.now()
    let lastQuotaPoll = Date.now()
    function tick() {
      if (document.visibilityState === 'hidden') return
      const now = Date.now()
      if (now - lastListPoll >= 15000) {
        lastListPoll = now
        void loadList({ silent: true, skipIfInFlight: true })
      }
      if (now - lastQuotaPoll >= 60000) {
        lastQuotaPoll = now
        void loadServiceReplies()
      }
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
      if (document.visibilityState === 'visible') { lastListPoll = 0; tick() }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [loadList, loadServiceReplies, pollConversationUpdates, selectedId])

  useEffect(() => {
    setError('')
    void loadList()
    return () => listAbortRef.current?.abort()
  }, [loadList])

  useEffect(() => {
    if (selectedId == null || Number.isNaN(selectedId)) {
      detailRequestIdRef.current += 1
      setDetail(null)
      setContactAttributes({})
      setLoadingDetail(false)
      setError('')
      return
    }

    setDetail(null)
    setContactAttributes({})
    setError('')
    setLoadingDetail(true)

    if (selectedId < 0) {
      const contactId = -selectedId
      const requestId = ++detailRequestIdRef.current
      void openContactChatRef.current(contactId, {
        navigateTo: (id) => {
          if (requestId !== detailRequestIdRef.current) return
          navigate(conversationPath(id), { replace: true })
        },
        onCancel: () => {
          if (requestId !== detailRequestIdRef.current) return
          setLoadingDetail(false)
          navigate('/conversations', { replace: true })
        },
      }).then((result) => {
        if (requestId !== detailRequestIdRef.current) return
        if (result === 'picking') {
          setLoadingDetail(false)
          return
        }
        if (result === 'failed') {
          setLoadingDetail(false)
          setError('No se pudo abrir el chat')
        }
      })
      return
    }

    void loadDetail(selectedId, highlightMsgId)
  }, [selectedId, highlightMsgId, navigate, loadDetail, conversationPath])

  useEffect(() => () => {
    detailRequestIdRef.current += 1
    detailAbortRef.current?.abort()
    pageAbortRef.current?.abort()
    pageAbortRef.current = null
    updatesAbortRef.current?.abort()
  }, [selectedId, highlightMsgId])

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
        return chatDisplayName({
          phone: detail.conversation.phone,
          contactName: crmName,
          profileName: detail.conversation.wa_profile_name,
          username: detail.conversation.wa_username,
        })
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
    whatsappUserId?: string | null
    prefillName?: string
  }) {
    setContactSheetMode(opts.mode)
    setContactSheetContactId(opts.contactId ?? null)
    setContactSheetPhone(opts.phone)
    setContactSheetUserId(opts.whatsappUserId ?? null)
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

  function setLineFilter(lineId: number | null) {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    if (lineId == null) next.delete('line')
    else next.set('line', String(lineId))
    setSearchParams(next)
  }

  function setDateRangeFilter(which: 'from' | 'to', value: string) {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    next.delete('range')
    if (showingDefaultRange) {
      if (which !== 'from' && dateFromFilter) next.set('from', dateFromFilter)
      if (which !== 'to' && dateToFilter) next.set('to', dateToFilter)
    }
    const trimmed = value.trim()
    if (isYmdDateParam(trimmed)) next.set(which, trimmed)
    else next.delete(which)
    if (!next.get('from') && !next.get('to')) next.set('range', 'all')
    setSearchParams(next)
  }

  function clearDateRangeFilter() {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    next.delete('from')
    next.delete('to')
    next.set('range', 'all')
    setSearchParams(next)
  }

  function restoreDefaultDateRange() {
    const next = new URLSearchParams(searchParams)
    next.delete('page')
    next.delete('from')
    next.delete('to')
    next.delete('range')
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
      const result = await openContactChat(item.contact_id, {
        navigateTo: (id) => navigate(conversationPath(id, item)),
        onCancel: () => setLoadingDetail(false),
      })
      if (result !== 'opened') setLoadingDetail(false)
      if (result === 'failed') setError('No se pudo abrir el chat')
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
    const switchingToBot = status === 'bot'
    const ok = await confirm({
      title: switchingToBot ? 'Pasar a modo Bot' : 'Pasar a modo Asesor',
      description: switchingToBot
        ? 'El bot volverá a atender este chat. Las respuestas humanas quedan pausadas hasta que lo pases a Asesor.'
        : 'El bot dejará de responder en este chat para que puedas escribir libremente.',
      confirmLabel: switchingToBot ? 'Pasar a Bot' : 'Pasar a Asesor',
    })
    if (!ok) return
    const result = await apiClient.patch<{ status: 'bot' | 'human' }>(
      `/api/conversations/${convId}/mode`,
      { status },
    )
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success(switchingToBot ? 'Modo Bot activado' : 'Modo Asesor activado')
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
    notify.success('Marcado como no leído')
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
    notify.success(archived ? 'Chat archivado' : 'Chat desarchivado')
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

  async function onLeadStatus(statusId: number) {
    const contactId =
      actionsContext?.contactId ??
      detail?.conversation.contact_id ??
      null
    if (!contactId) return
    const result = await apiClient.patch<{
      lead_status_id: number | null
      lead_status: { id: number; slug: string; label: string } | null
    }>(`/api/leads/contacts/${contactId}/status`, {
      status_id: statusId,
      category: detail?.conversation.line_program || 'general',
    })
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setActionsContext((prev) =>
      prev
        ? {
            ...prev,
            leadStatusId: result.data.lead_status_id,
            leadStatusLabel: result.data.lead_status?.label ?? null,
          }
        : prev,
    )
    if (selectedId) void loadDetail(selectedId)
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
    const file = replyFile
    const replyTo = replyToMessage
    if (!text && !file) {
      notify.error('Escribe un mensaje o adjunta un archivo')
      return
    }
    setSendingReply(true)
    const replyPayload = replyTo
      ? { message: text, reply_to_message_id: replyTo.id }
      : { message: text }
    const result = file
      ? await (() => {
          const formData = new FormData()
          if (text) formData.append('message', text)
          formData.append('file', file)
          if (replyTo) {
            formData.append('reply_to_message_id', String(replyTo.id))
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
    void loadServiceReplies()

    const sent = result.data.messages ?? []
    const convId = selectedId
    if (detailRef.current?.has_newer_messages) void loadDetail(convId)
    setDetail((prev) => {
      if (!prev || prev.conversation.id !== convId || prev.has_newer_messages) return prev
      const byId = new Map(prev.messages.map((message) => [message.id, message]))
      for (const message of sent) byId.set(message.id, message)
      const merged = [...byId.values()].sort((a, b) => a.id - b.id)
      const last = merged[merged.length - 1]
      return {
        ...prev,
        messages: merged,
        conversation: {
          ...prev.conversation,
          last_message_at: last?.created_at ?? prev.conversation.last_message_at,
        },
      }
    })

    const previewText = text
      ? text.length > 120
        ? `${text.slice(0, 120)}…`
        : text
      : file
        ? file.name
        : ''
    const nowIso = new Date().toISOString()
    setList((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        items: prev.items.map((row) =>
          row.id === convId
            ? {
                ...row,
                preview: previewText || row.preview,
                last_message_at: nowIso,
                last_outbound_message_at: nowIso,
                inbox_unread: false,
              }
            : row,
        ),
      }
    })
    requestAnimationFrame(() => scrollerRef.current?.scrollToBottom('smooth'))
  }

  const canAssign =
    detail?.can_assign_conversations ?? list?.can_assign_conversations ?? false

  const canOpenListContact = (contactId: number | null | undefined, _phone: string | null) =>
    contactId ? userCanUpdateContacts(user) : userCanCreateContacts(user)

  useEffect(() => {
    if ((!assignContext && !bulkActionsOpen) || !canAssign) return
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
  }, [assignContext, bulkActionsOpen, canAssign])

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
    notify.success(
      assignedUserId == null ? 'Chat sin asignar' : 'Chat asignado',
    )
    if (selectedId === convId) void loadDetail(convId)
    void loadList()
  }

  const segments = list?.segments ?? []
  const assignableSegments = list?.assignable_segments ?? []
  const canBulkSelect =
    canAssign || assignableSegments.length > 0 || bulkAttrDefs.length > 0
  const allowBulkUnassign = !['educacion', 'educacion_ca', 'educacion_ep'].includes(
    user?.area ?? '',
  )
  const bulkSegmentOptions = useMemo(
    () =>
      assignableSegments.map((seg) => ({
        slug: seg.slug,
        label: seg.label,
        group: (seg.assignment_group ?? '').trim() || undefined,
      })),
    [assignableSegments],
  )

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

  async function applyBulkSegment(segmentSlug: string): Promise<boolean> {
    if (!segmentSlug || selectedContactIds.size === 0) return false
    setBulkBusy(true)
    const res = await apiClient.post<{ updated: number }>(
      '/api/contacts/bulk-add-segment',
      {
        segment_slug: segmentSlug,
        contact_ids: [...selectedContactIds],
        assignable_only: true,
      },
    )
    setBulkBusy(false)
    if (!res.ok) {
      notify.error(res.error)
      return false
    }
    notify.success(`Segmento aplicado a ${res.data.updated} contacto(s)`)
    void loadList({ silent: true })
    return true
  }

  async function applyBulkAttribute(
    attrKey: string,
    attrValue: string,
  ): Promise<boolean> {
    if (!attrKey || selectedContactIds.size === 0) return false
    setBulkBusy(true)
    const res = await apiClient.post<{ updated: number }>(
      '/api/contacts/bulk-set-attribute',
      {
        attr_key: attrKey,
        attr_value: attrValue,
        contact_ids: [...selectedContactIds],
      },
    )
    setBulkBusy(false)
    if (!res.ok) {
      notify.error(res.error)
      return false
    }
    notify.success(`Atributo aplicado a ${res.data.updated} contacto(s)`)
    void loadList({ silent: true })
    return true
  }

  async function applyBulkAssign(
    assignedUserId: number | null,
  ): Promise<boolean> {
    if (!canAssign || selectedContactIds.size === 0) return false
    if (assignedUserId == null && !allowBulkUnassign) return false
    setBulkBusy(true)
    const res = await apiClient.post<{ updated: number }>(
      '/api/conversations/bulk-assign',
      {
        contact_ids: [...selectedContactIds],
        assigned_user_id: assignedUserId,
      },
    )
    setBulkBusy(false)
    if (!res.ok) {
      notify.error(res.error)
      return false
    }
    notify.success(
      assignedUserId == null
        ? `${res.data.updated} chat(s) sin asignar`
        : `${res.data.updated} chat(s) asignado(s)`,
    )
    if (selectedId) void loadDetail(selectedId)
    void loadList({ silent: true })
    return true
  }

  function onBulkActionsOpenChange(open: boolean) {
    setBulkActionsOpen(open)
    if (!open) clearContactSelection()
  }

  const displayName = (item: InboxListItem) => {
    const crmName = String(item.contact_name ?? '').trim()
    return chatDisplayName({
      phone: item.phone,
      contactName: crmName,
      profileName: item.wa_profile_name,
      username: item.wa_username,
    })
  }

  if (error && !list) {
    return (
      <div className="space-y-3 p-4">
        <p className="text-muted">No se pudo cargar</p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            setError('')
            void loadList()
          }}
        >
          Reintentar
        </Button>
      </div>
    )
  }

  const chatFilterLabels: Record<string, string> = {
    all: 'Todos', mine: 'Mis chats', unassigned: 'Sin asignar', unread: 'Sin leer',
    unanswered: 'Sin responder', bot: 'Bot', human: 'Atención humana',
    archived: 'Archivados', archived_auto: 'Archivados sin respuesta', archived_manual: 'Archivados manuales',
  }
  function selectedSegmentLabel(token: string) {
    if (token === '__none__') return 'Sin segmento'
    const segment = segments.find(item => token.startsWith('id:') ? item.id === Number(token.slice(3)) : item.slug === token)
    if (!segment) return 'Segmento seleccionado'
    const category = segment.category === 'general' ? 'General' : segment.category?.toUpperCase()
    return canonicalArea(user?.area ?? '') === 'educacion' && category ? category + ' · ' + segment.label : segment.label
  }
  const showLineFilter = inboxLines.length > 1
  const lineFilterMixesCategories = new Set(inboxLines.map((line) => line.category)).size > 1
  const selectedLine = lineFilter != null
    ? inboxLines.find((line) => line.id === lineFilter) ?? null
    : null
  const activeFilterCount = (chatFilter !== 'all' ? 1 : 0) + selectedSegments.length +
    (windowMaxFilter != null ? 1 : 0) + (lineFilter != null ? 1 : 0) +
    (dateFromFilter || dateToFilter ? 1 : 0) +
    (searchQuery && inboxSearchMessagesParam(searchParams) ? 1 : 0) +
    (searchQuery && rangeAll && !explicitFrom && !explicitTo ? 1 : 0)
  const filterPills = (
    <>
      <div className="inbox-chat-filter-pills inbox-chat-filter-pills--row inbox-chat-filter-pills--compact" aria-label="Vistas de chats">
        {(['all', 'mine', 'unassigned'] as const).map(key => (
          <Button key={key} type="button" size="sm" variant={chatFilter === key ? 'default' : 'outline'}
            className="rounded-full" aria-pressed={chatFilter === key} onClick={() => setChatFilter(key)}>
            {chatFilterLabels[key]}
          </Button>
        ))}
      </div>
      <div className="inbox-filters space-y-2">
        <div className="inbox-search-row">
          <input type="search" value={searchInput} onChange={e => setSearchInput(e.target.value)}
            onKeyDown={onSearchKeyDown} placeholder="Buscar nombre o teléfono…" className="inbox-search-input" aria-label="Buscar en chats" />
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" size="sm" variant={activeFilterCount ? 'secondary' : 'outline'}>
                Filtros{activeFilterCount ? ' · ' + activeFilterCount : ''}
              </Button>
            </PopoverTrigger>
            <PopoverContent side="right" align="start" sideOffset={16} collisionPadding={12} className="w-80 max-w-[calc(100vw-24px)] max-h-[70vh] overflow-y-auto space-y-4">
              <div className="flex items-center justify-between"><strong>Filtros de chats</strong>
                <button type="button" className="text-xs text-muted underline" onClick={clearListFilters}>Restablecer</button>
              </div>
              <p className="text-xs text-muted">Elige una vista y afínala con línea, segmentos, fechas y ventana.</p>
              <fieldset className="inbox-filter-group space-y-2">
                <legend className="text-sm font-medium">Búsqueda</legend>
                <label className="flex items-center gap-2 text-sm" title="Busca también en el texto de los mensajes (mín. 4 caracteres, o 3 dígitos de teléfono)">
                  <input
                    type="checkbox"
                    checked={inboxSearchMessagesParam(searchParams)}
                    disabled={!searchQuery}
                    onChange={(e) => {
                      const next = new URLSearchParams(searchParams)
                      next.delete('page')
                      if (e.target.checked) next.set('qm', '1')
                      else next.delete('qm')
                      setSearchParams(next)
                    }}
                  />
                  Incluir mensajes
                </label>
                {searchQuery && inboxSearchMessagesParam(searchParams) && !inboxSearchMayScanMessages(searchQuery, true) ? (
                  <p className="text-xs text-muted">Escribe al menos 4 caracteres (o 3 dígitos) para buscar en mensajes.</p>
                ) : null}
                <label className="flex items-center gap-2 text-sm" title="Sin límite de fechas. Por defecto la búsqueda mira los últimos 30 días.">
                  <input
                    type="checkbox"
                    checked={rangeAll && !explicitFrom && !explicitTo}
                    disabled={!searchQuery}
                    onChange={(e) => {
                      const next = new URLSearchParams(searchParams)
                      next.delete('page')
                      next.delete('from')
                      next.delete('to')
                      if (e.target.checked) next.set('range', 'all')
                      else next.delete('range')
                      setSearchParams(next)
                    }}
                  />
                  Buscar en todo el historial
                </label>
                {searchQuery && !rangeAll && !explicitFrom && !explicitTo ? (
                  <p className="text-xs text-muted">Ventana actual: últimos 30 días.</p>
                ) : null}
              </fieldset>
              <fieldset className="inbox-filter-group space-y-2"><legend className="text-sm font-medium">Atención</legend>
                {(['all','mine','unassigned','unread','unanswered', ...(list?.ai_area_enabled ? ['bot'] : [])] as const).map(key => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="inbox-view" checked={chatFilter === key} onChange={() => setChatFilter(key as InboxListResult['filters']['chat'])} />
                    {chatFilterLabels[key]}{key === 'unread' && list?.unread_count ? ' (' + list.unread_count + ')' : ''}
                  </label>
                ))}
              </fieldset>
              {showLineFilter ? (
                <fieldset className="inbox-filter-group space-y-2">
                  <legend className="text-sm font-medium">Línea</legend>
                  <select
                    className="w-full rounded border border-line bg-surface px-2 py-1.5 text-sm"
                    aria-label="Filtrar por línea de WhatsApp"
                    value={lineFilter ?? ''}
                    onChange={(e) =>
                      setLineFilter(e.target.value ? Number(e.target.value) : null)
                    }
                  >
                    <option value="">Todas</option>
                    {inboxLines.map((line) => (
                      <option key={line.id} value={line.id}>
                        {lineFilterMixesCategories
                          ? `${line.category_label} · ${inboxLineLabel(line)}`
                          : inboxLineLabel(line)}
                      </option>
                    ))}
                  </select>
                </fieldset>
              ) : null}
              <fieldset className="inbox-filter-group space-y-2"><legend className="text-sm font-medium">Clasificación · Segmentos</legend>
          <SegmentFilterSelect
            segments={segments.map(segment => ({ ...segment, slug: segment.id ? 'id:' + segment.id : segment.slug, group: canonicalArea(user?.area ?? '') === 'educacion' ? segment.category === 'general' ? 'General' : segment.category?.toUpperCase() : undefined }))}
            selectedSlugs={selectedSegments}
            onToggle={toggleSegment}
            onClearAll={() => {
              const next = new URLSearchParams(searchParams)
              next.delete('segment')
              next.delete('page')
              setSearchParams(next)
            }}
          />
              </fieldset>
              <fieldset className="inbox-filter-group space-y-2"><legend className="text-sm font-medium">Tiempo · Último mensaje</legend>
        <div className="flex flex-wrap items-center gap-2 px-3 text-xs">
          <label className="muted flex items-center gap-1">
            Desde
            <input
              type="date"
              value={dateFromFilter}
              onChange={(e) => setDateRangeFilter('from', e.target.value)}
              className="rounded border border-line bg-surface px-1 py-0.5 text-ink"
              aria-label="Fecha desde último mensaje"
            />
          </label>
          <label className="muted flex items-center gap-1">
            Hasta
            <input
              type="date"
              value={dateToFilter}
              onChange={(e) => setDateRangeFilter('to', e.target.value)}
              className="rounded border border-line bg-surface px-1 py-0.5 text-ink"
              aria-label="Fecha hasta último mensaje"
            />
          </label>
          {dateFromFilter || dateToFilter || explicitFrom || explicitTo ? (
            <button
              type="button"
              className="small-btn compact"
              onClick={clearDateRangeFilter}
            >
              Limpiar fechas
            </button>
          ) : null}
          {rangeAll ? (
            <button
              type="button"
              className="small-btn compact"
              onClick={restoreDefaultDateRange}
            >
              Últimos 15 días
            </button>
          ) : null}
        </div>
                {!isArchivedChatFilter(chatFilter) ? <label className="flex items-center justify-between gap-2 text-xs">
                  <span className="flex items-center gap-1"><WindowClockIcon /> Ventana restante</span>
                  <select className="rounded border border-line bg-surface px-2 py-1" aria-label="Horas restantes de ventana" value={windowMaxFilter ?? ''}
                    onChange={e => setWindowMaxFilter(e.target.value ? Number(e.target.value) as WindowMaxFilter : null)}>
                    <option value="">Todas</option>{WINDOW_MAX_BUCKETS.map(hours => <option key={hours} value={hours}>≤{hours}h</option>)}
                  </select>
                </label> : null}
              </fieldset>
              <fieldset className="inbox-filter-group space-y-2"><legend className="flex items-center gap-1 text-sm font-medium"><ArchiveChatsIcon /> Archivo{list?.archived_count != null ? ' (' + list.archived_count + ')' : ''}</legend>
                {(['archived','archived_auto','archived_manual'] as const).map(key => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="inbox-view" checked={chatFilter === key} onChange={() => setChatFilter(key)} />{chatFilterLabels[key]}
                  </label>
                ))}
              </fieldset>
            </PopoverContent>
          </Popover>
        </div>
        <div className="inbox-active-filters" aria-label="Filtros activos">
          {chatFilter !== 'all' ? <button type="button" className="inbox-filter-chip" onClick={() => setChatFilter('all')} aria-label={'Quitar filtro ' + chatFilterLabels[chatFilter]}>{chatFilterLabels[chatFilter]} <span aria-hidden>×</span></button> : null}
          {selectedSegments.map(slug => <button key={slug} type="button" className="inbox-filter-chip" onClick={() => toggleSegment(slug)} aria-label={'Quitar segmento ' + selectedSegmentLabel(slug)}>{selectedSegmentLabel(slug)} <span aria-hidden>×</span></button>)}
          {lineFilter != null ? (
            <button
              type="button"
              className="inbox-filter-chip"
              onClick={() => setLineFilter(null)}
              aria-label="Quitar filtro de línea"
            >
              {selectedLine
                ? (lineFilterMixesCategories
                  ? `${selectedLine.category_label} · ${inboxLineLabel(selectedLine)}`
                  : inboxLineLabel(selectedLine))
                : 'Línea'} <span aria-hidden>×</span>
            </button>
          ) : null}
          {windowMaxFilter != null ? <button type="button" className="inbox-filter-chip" onClick={() => setWindowMaxFilter(null)} aria-label="Quitar filtro de ventana">Ventana ≤{windowMaxFilter}h <span aria-hidden>×</span></button> : null}
          {dateFromFilter || dateToFilter ? <button type="button" className="inbox-filter-chip" onClick={clearDateRangeFilter} aria-label="Quitar filtro de fechas">{showingDefaultRange ? 'Últimos 15 días' : [dateFromFilter ? 'Desde ' + dateFromFilter : '', dateToFilter ? 'Hasta ' + dateToFilter : ''].filter(Boolean).join(' · ')} <span aria-hidden>×</span></button> : null}
          {searchQuery && inboxSearchMessagesParam(searchParams) ? (
            <button
              type="button"
              className="inbox-filter-chip"
              onClick={() => {
                const next = new URLSearchParams(searchParams)
                next.delete('qm')
                next.delete('page')
                setSearchParams(next)
              }}
              aria-label="Quitar búsqueda en mensajes"
            >
              Mensajes{inboxSearchMayScanMessages(searchQuery, true) ? '' : ' (corto)'} <span aria-hidden>×</span>
            </button>
          ) : null}
          {searchQuery && rangeAll && !explicitFrom && !explicitTo ? (
            <button
              type="button"
              className="inbox-filter-chip"
              onClick={() => {
                const next = new URLSearchParams(searchParams)
                next.delete('range')
                next.delete('page')
                setSearchParams(next)
              }}
              aria-label="Quitar búsqueda en todo el historial"
            >
              Todo el historial <span aria-hidden>×</span>
            </button>
          ) : null}
          {searchQuery && !rangeAll && !explicitFrom && !explicitTo ? (
            <span className="inbox-filter-chip inbox-filter-chip--static" title="La búsqueda usa los últimos 30 días salvo que actives todo el historial">
              Búsqueda · 30 días
            </span>
          ) : null}
        </div>
      </div>
      {canBulkSelect && selectedContactIds.size > 0 ? (
        <div className="flex flex-wrap items-center gap-1 px-3 py-1 text-xs">
          <button
            type="button"
            className="small-btn compact"
            onClick={selectAllVisibleContacts}
          >
            Seleccionar página
          </button>
          <button
            type="button"
            className="small-btn compact"
            onClick={clearContactSelection}
          >
            Cancelar selección
          </button>
          <button
            type="button"
            className="small-btn primary compact"
            disabled={selectedContactIds.size === 0}
            onClick={() => setBulkActionsOpen(true)}
          >
            Acciones
            {selectedContactIds.size > 0 ? ` (${selectedContactIds.size})` : ''}
          </button>
        </div>
      ) : null}
    </>
  )

  return (
    <WaPageContents>
      <WaSidebar
        title={
          listBusy
            ? 'Chats (buscando…)'
            : listCount != null
              ? `Chats (${listCount})`
              : 'Chats'
        }
        className="relative conversations-inbox-sidebar"
        actions={
          <>
          {serviceReplies ? <Popover><PopoverTrigger asChild>
            <button type="button" className="small-btn compact" aria-label="Ver consumo mensual de respuestas" title="Consumo mensual">ⓘ</button>
          </PopoverTrigger><PopoverContent side="right" align="start" sideOffset={16} collisionPadding={12} className="w-80 max-w-[calc(100vw-24px)] p-0">
            <div className="border-b border-line px-3 py-2.5">
              <p className="text-sm font-medium">Consumo mensual</p>
              <p className="text-xs text-muted">{serviceReplyMonthTitle(serviceReplies.monthLabel)}</p>
            </div>
            {serviceReplies.lines.length === 0 ? (
              <p className="px-3 py-2.5 text-xs text-muted">No hay números en esta selección.</p>
            ) : (
              <ServiceReplyQuotaList lines={serviceReplies.lines} />
            )}
          </PopoverContent></Popover> : null}
          {browserNotifySupported ? (
            <button
              type="button"
              className={`small-btn compact inbox-notify-bell-btn${browserNotifyActive ? ' is-active' : ''}`}
              aria-pressed={browserNotifyActive}
              aria-label={
                browserNotifyPermission === 'denied'
                  ? 'Avisos bloqueados en el navegador'
                  : browserNotifyActive
                    ? 'Desactivar avisos de Mis chats'
                    : 'Activar avisos de Mis chats'
              }
              title={
                browserNotifyPermission === 'denied'
                  ? 'Avisos bloqueados en el navegador. Actívalos en la configuración del sitio.'
                  : browserNotifyActive
                    ? 'Avisos activos — clic para desactivar'
                    : 'Activar avisos de Mis chats'
              }
              onClick={() => {
                if (browserNotifyActive) {
                  disableBrowserNotify()
                  return
                }
                void enableBrowserNotify()
              }}
            >
              {browserNotifyPermission === 'denied' && !browserNotifyActive ? (
                <InboxNotifyBellOffIcon />
              ) : (
                <InboxNotifyBellIcon active={browserNotifyActive} />
              )}
            </button>
          ) : null}
          </>
        }
        filters={filterPills}
        floating={
          listCanScroll ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={`inbox-chat-list-scroll-btn absolute z-10 size-8 rounded-full p-0 shadow-md${
                listMatchesFilters && listPages > 1
                  ? ' inbox-chat-list-scroll-btn--above-pager'
                  : ''
              }`}
              onClick={scrollChatListEdge}
              aria-label={listScrollAtEnd ? 'Ir al inicio de la lista' : 'Ir al final de la lista'}
              title={listScrollAtEnd ? 'Ir al inicio' : 'Ir al final'}
            >
              {listScrollAtEnd ? '↑' : '↓'}
            </Button>
          ) : null
        }
        footer={
          listMatchesFilters && listPages > 1 ? (
            <div className="inbox-chat-list-pager inbox-chat-list-pager--sticky" role="navigation" aria-label="Paginación de chats">
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
            </div>
          ) : null
        }
      >
        <ul className={`inbox-chat-list${showStaleList ? ' is-searching' : ''}`}>
          {!list ? (
            <li className="inbox-empty-list">Cargando…</li>
          ) : listBusy && !showStaleList ? (
            <li className="inbox-empty-list">Buscando…</li>
          ) : listMatchesFilters && list.items.length === 0 ? (
            <li className="inbox-empty-list">
              <span>No hay conversaciones.</span>
              {hasActiveListFilters ? (
                <button
                  type="button"
                  className="small-btn compact mt-2"
                  onClick={clearListFilters}
                >
                  Limpiar filtros
                </button>
              ) : null}
            </li>
          ) : (
            (listMatchesFilters || showStaleList ? list.items : []).map((item) => {
              const active = selectedId === item.id
              const crmName = String(item.contact_name ?? '').trim()
              const waAlias = String(item.wa_profile_name ?? '').trim()
              const name = displayName(item)
              const hasContactName = Boolean(crmName)
              const hasWaAlias = !hasContactName && Boolean(waAlias || item.wa_username)
              const showPhoneRow = hasContactName || hasWaAlias || !item.phone
              const leadScore = item.contact_lead_score
              const hasConversation = !item.is_virtual
              const actionsCtx = chatActionsFromListItem(
                item,
                list!.ai_area_enabled,
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
              const previewText = listPreviewText(item.preview)
              const modeStatus = String(item.conversation_status ?? '').toLowerCase()
              return (
                <ContextMenu key={item.id}>
                  <ContextMenuTrigger asChild>
                    <li
                      className={`inbox-chat-item ${item.inbox_unread ? 'inbox-chat-item--unread' : ''} ${active ? 'is-active' : ''}`}
                    >
                      <div className="inbox-chat-item-shell">
                        {item.line_label ||
                        item.line_program ||
                        item.line_display_phone ||
                        item.assigned_user_label ? (
                          <div className="inbox-chat-item-meta">
                            {item.line_label || item.line_program || item.line_display_phone ? (
                              <span className="inbox-chat-line" title={item.line_display_phone || undefined}>
                                <InboxWhatsAppIcon />
                                <span className="inbox-chat-line-identity">
                                  <span>
                                    {item.line_label ||
                                      item.line_program?.toUpperCase() ||
                                      'Línea de WhatsApp'}
                                  </span>
                                  {item.line_display_phone ? (
                                    <>
                                      <span className="inbox-chat-line-sep" aria-hidden>
                                        ·
                                      </span>
                                      <span className="inbox-chat-line-phone">
                                        {displayPhoneNumber(item.line_display_phone)}
                                      </span>
                                    </>
                                  ) : null}
                                </span>
                              </span>
                            ) : (
                              <span />
                            )}
                            {item.assigned_user_label ? (
                              <span
                                className="inbox-chat-assignee"
                                title={`Asignado a ${item.assigned_user_label}`}
                              >
                                <svg
                                  viewBox="0 0 24 24"
                                  width="12"
                                  height="12"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.7"
                                  aria-hidden="true"
                                >
                                  <circle cx="12" cy="7" r="3" />
                                  <path d="M5 21v-3a7 7 0 0 1 14 0v3Z" />
                                </svg>
                                <span>{item.assigned_user_label}</span>
                              </span>
                            ) : null}
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void onSelectItem(item)}
                          className="inbox-chat-item-btn"
                        >
                          <span className="inbox-chat-item-primary">
                            <span className="inbox-chat-avatar-wrap">
                              {canBulkSelect && contactIdForBulk(item) != null ? (
                                <label
                                  className={`inbox-chat-item-check ${selectedContactIds.has(contactIdForBulk(item)!) ? 'is-selected' : ''}`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selectedContactIds.has(contactIdForBulk(item)!)}
                                    onChange={() => toggleContactSelection(contactIdForBulk(item)!)}
                                    onClick={(event) => event.stopPropagation()}
                                    aria-label={`Seleccionar ${name}`}
                                  />
                                </label>
                              ) : null}
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
                                {inboxInitials(name, item.phone)}
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
                                    <LeadScoreBadge score={leadScore} />
                                  ) : null}
                                </span>
                              </span>
                              {showPhoneRow ? (
                                <span className="inbox-chat-phone-row">
                                  <span className="inbox-chat-phone">
                                    {chatSecondaryLabel(item.phone)}
                                  </span>
                                  {leadScore ? <LeadScoreBadge score={leadScore} /> : null}
                                  <ConversationBadges
                                    status={item.conversation_status}
                                    assignedUserLabel={item.assigned_user_label}
                                    hideAssignee
                                    archived={item.archived}
                                    unanswered={!item.last_user_message_at}
                                  />
                                </span>
                              ) : (
                                <ConversationBadges
                                  status={item.conversation_status}
                                  assignedUserLabel={item.assigned_user_label}
                                  hideAssignee
                                  archived={item.archived}
                                  unanswered={!item.last_user_message_at}
                                />
                              )}
                              <span className="inbox-chat-row-mid">
                                <span className="inbox-chat-preview" title={previewText}>
                                  {previewText}
                                </span>
                              </span>
                            </span>
                          </span>
                        </button>
                        <div className="inbox-chat-side">
                          {item.inbox_unread ? (
                            <span
                              className={`inbox-unread-dot ${(item.unread_message_count ?? 0) > 0 ? 'inbox-unread-dot--count' : ''}`}
                              title={
                                item.unread_message_count
                                  ? `${item.unread_message_count} mensajes sin leer`
                                  : 'No leído'
                              }
                              aria-label={
                                item.unread_message_count
                                  ? `${item.unread_message_count} mensajes sin leer`
                                  : 'No leído'
                              }
                            >
                              {(item.unread_message_count ?? 0) > 0
                                ? (item.unread_message_count ?? 0) > 99
                                  ? '99+'
                                  : item.unread_message_count
                                : null}
                            </span>
                          ) : null}
                          <span
                            className="inbox-chat-msg-times"
                            title={[
                              `Actividad: ${formatChatListTime(item.last_message_at)}`,
                              `Entrante: ${formatChatListTime(item.last_user_message_at)}`,
                              `Saliente: ${formatChatListTime(item.last_outbound_message_at)}`,
                              replyStatus?.title,
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                          >
                            <span className="inbox-chat-msg-time">
                              {formatChatListTime(item.last_message_at)}
                            </span>
                            {replyStatus ? (
                              <span
                                className={`inbox-chat-msg-time inbox-chat-msg-time--lag${
                                  replyStatus.symbol === '⏳' ? ' is-waiting' : ''
                                }`}
                              >
                                <span aria-hidden>{replyStatus.symbol}</span>
                                {replyStatus.label}
                              </span>
                            ) : null}
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
                      </div>
                      {item.contact_segment_slugs.length > 0 ? <InboxSegmentSummary items={item.contact_segment_slugs.map(slug => ({ slug, label: segmentLabel(slug, segments), color: segmentColorKey(slug, segments) }))} /> : null}
                    </li>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-52">
                    <ContextMenuGroup>
                      <ContextMenuLabel className="truncate normal-case">
                        {name}
                      </ContextMenuLabel>
                      {canOpenListContact(item.contact_id, item.phone) ? (
                        <ContextMenuItem
                          onSelect={() =>
                            openAfterContextMenu(() =>
                              openContactSheet({
                                mode: item.contact_id ? 'edit' : 'create',
                                contactId: item.contact_id,
                                phone: item.phone || '',
                                whatsappUserId: item.whatsapp_user_id,
                                prefillName: waAlias,
                              }),
                            )
                          }
                        >
                          {item.contact_id ? 'Editar contacto' : 'Guardar contacto'}
                        </ContextMenuItem>
                      ) : null}
                      {hasConversation && canAssign ? (
                        <ContextMenuItem
                          onSelect={() =>
                            openAfterContextMenu(() =>
                              openAssignDialog({
                                conversationId: item.id,
                                heading: name,
                                phone: item.phone || '',
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
        </ul>
      </WaSidebar>

      <WaMainPane>
        {selectedId == null ? (
          showSummary ? <Suspense fallback={<p className="p-4 text-muted">Cargando resumen…</p>}><ConversationsSummaryPane /></Suspense> : (
            <WaEmptyPane>
              <p>Selecciona una conversación para ver sus mensajes.</p>
              <button type="button" className="small-btn" onClick={() => setShowSummary(true)}>Ver resumen de conversaciones</button>
            </WaEmptyPane>
          )
        ) : loadingDetail && !detail ? (
          <WaEmptyPane heading="Cargando chat…" />
        ) : error && !detail ? (
          <WaEmptyPane heading="No se pudo cargar">
            <div className="inbox-empty-hint space-y-3">
              <h2 className="inbox-empty-heading">No se pudo cargar</h2>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (selectedId != null && selectedId > 0) void loadDetail(selectedId)
                }}
              >
                Reintentar
              </Button>
            </div>
          </WaEmptyPane>
        ) : detail ? (
          <>
            <WaMainHeader>
              <div className="inbox-chat-header-profile">
                <ProfileBlock
                  detail={detail}
                  segments={segments}
                  onBack={() => navigate(`/conversations${filterQuerySuffix}`)}
                  onOpenContact={() =>
                    openContactSheet({
                      mode: detail.conversation.contact_id ? 'edit' : 'create',
                      contactId: detail.conversation.contact_id,
                      phone: detail.conversation.phone || '',
                      whatsappUserId: detail.conversation.whatsapp_user_id,
                      prefillName: detail.conversation.wa_profile_name ?? '',
                    })
                  }
                  actions={
                    <>
                      {canAssign ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="inbox-chat-header-assign"
                          onClick={() =>
                            openAssignDialog({
                              conversationId: detail.conversation.id,
                              heading: detailHeading,
                              phone: detail.conversation.phone || '',
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
                            chatActionsFromDetail(
                              detail,
                              detailHeading,
                              detail.ai_area_enabled,
                            ),
                          )
                        }
                      >
                        <span className="inbox-header-more-icon" aria-hidden>
                          ⋮
                        </span>
                      </Button>
                    </>
                  }
                />
              </div>
            </WaMainHeader>

            <div className="inbox-chat-body">
              <InboxMessageScroller
                ref={scrollerRef}
                conversationId={detail.conversation.id}
                scrollToMessageId={resolvedHighlightMsgId}
                onLoadOlder={() => void loadMessagePage('before')}
                onLoadNewer={() => void loadMessagePage('after')}
                onJumpToLatest={detail.has_newer_messages ? () => void loadDetail(detail.conversation.id) : undefined}
              >
                {detail.has_older_messages ? (
                  <div className="flex justify-center py-2">
                    <button
                      type="button"
                      className="small-btn compact"
                      disabled={loadingMessagePage}
                      onClick={() => void loadMessagePage('before')}
                    >
                      {loadingMessagePage
                        ? 'Cargando…'
                        : 'Cargar mensajes anteriores'}
                    </button>
                  </div>
                ) : null}
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
                {detail.has_newer_messages ? (
                  <div className="flex justify-center py-2">
                    <button type="button" className="small-btn compact" disabled={loadingMessagePage}
                      onClick={() => void loadMessagePage('after')}>
                      {loadingMessagePage ? 'Cargando…' : 'Cargar mensajes siguientes'}
                    </button>
                  </div>
                ) : null}
              </InboxMessageScroller>
            </div>

            <WaMainFooter>
              <InboxComposeBar
                replyText={replyText}
                onReplyTextChange={setReplyText}
                replyFile={replyFile}
                onReplyFileChange={setReplyFile}
                sendingReply={sendingReply}
                onSubmit={(e) => void onSendReply(e)}
                replyTo={replyToMessage}
                onClearReplyTo={() => setReplyToMessage(null)}
                windowOpen={detail.user_service_window_open}
                canReply={detail.can_reply}
                replyBlockedReason={detail.reply_blocked_reason}
                conversationId={detail.conversation.id}
                canSendTemplate={canSendTemplate}
                onOpenTemplate={() => setTemplateOpen(true)}
                onSwitchToHuman={() => void onModeChange('human', detail.conversation.id)}
                onFlowStarted={() => void loadDetail(detail.conversation.id)}
                contactAttributes={contactAttributes}
                contactName={
                  formatContactName(
                    detail.contact?.name,
                    detail.contact?.last_name,
                  ) ||
                  String(detail.conversation.wa_profile_name ?? '').trim()
                }
                contactPhone={
                  detail.contact?.phone ||
                  (isContactPhone(detail.conversation.phone) ? detail.conversation.phone || '' : '')
                }
                contactEmail={detail.contact?.email || ''}
                contactDni={detail.contact?.dni || ''}
              />
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
          leadStatusId={actionsContext.leadStatusId}
          leadStatusLabel={actionsContext.leadStatusLabel}
          aiAreaEnabled={actionsContext.aiAreaEnabled}
          conversationStatus={actionsContext.conversationStatus}
          canAssign={canAssign}
          assignableSegments={list?.assignable_segments ?? []}
          category={detail?.conversation.line_program || 'general'}
          currentSegmentSlugs={
            detail?.contact?.segment_slugs ??
            list?.items.find((i) => i.id === actionsContext.conversationId)
              ?.contact_segment_slugs ??
            []
          }
          onLeadScore={onLeadScore}
          onLeadStatus={onLeadStatus}
          onMarkUnread={() => void onMarkUnread(actionsContext.conversationId)}
          onSetArchived={(archived) =>
            void onSetArchived(archived, actionsContext.conversationId)
          }
          archived={actionsContext.archived}
          lastUserMessageAt={actionsContext.lastUserMessageAt}
          onModeChange={onModeChange}
          onAssign={() => openAssignFromActions(actionsContext)}
          canOpenContact={canOpenListContact(actionsContext.contactId, actionsContext.phone)}
          onOpenContact={() =>
            openContactSheet({
              mode: actionsContext.contactId ? 'edit' : 'create',
              contactId: actionsContext.contactId,
              phone: actionsContext.phone,
              whatsappUserId: actionsContext.whatsappUserId,
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
        conversationId={selectedId}
        prefillPhone={contactSheetPhone}
        prefillUserId={contactSheetUserId}
        prefillUsername={detail?.conversation.whatsapp_user_id === contactSheetUserId ? detail.conversation.wa_username : null}
        prefillName={contactSheetPrefillName}
        category={
          detail ? detail.conversation.line_program || 'general' : null
        }
        onSaved={() => {
          void loadList()
          if (selectedId) void loadDetail(selectedId)
        }}
      />

      {detail && selectedId && canSendTemplate ? (
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
          allowUnassign={!['educacion', 'educacion_ca', 'educacion_ep'].includes(user?.area ?? '')}
          assignees={assignees}
          loading={assigneesLoading}
          saving={assignSaving}
          onSave={(assignedUserId) => void onAssign(assignedUserId)}
        />
      ) : null}
      <BulkContactActionsDialog
        open={bulkActionsOpen}
        onOpenChange={onBulkActionsOpenChange}
        selectedCount={selectedContactIds.size}
        segments={bulkSegmentOptions}
        attributeDefinitions={bulkAttrDefs}
        busy={bulkBusy}
        onApplySegment={applyBulkSegment}
        onApplyAttribute={applyBulkAttribute}
        assignees={canAssign ? assignees : undefined}
        assigneesLoading={canAssign ? assigneesLoading : false}
        allowUnassign={allowBulkUnassign}
        onApplyAssign={canAssign ? applyBulkAssign : undefined}
      />
      {confirmDialog}
      {linePickerDialog}
    </WaPageContents>
  )
}
