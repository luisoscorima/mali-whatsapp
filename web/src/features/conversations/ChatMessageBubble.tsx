import type { ReactNode } from 'react'
import { formatDateTime } from '@/shared/format'
import { cn } from '@/lib/utils'
import type { CampaignMessagePreviewData } from '../campaigns/CampaignMessagePreview'
import { ChatCampaignPreview } from './ChatCampaignPreview'
import { ChatMessageBubbleMenu } from './ChatMessageBubbleMenu'

export type ChatMessage = {
  id: number
  direction: string
  body_text: string | null
  message_type: string
  created_at: string
  is_ai: boolean
  has_downloadable_media: boolean
  reaction?: { emoji: string; direction: 'inbound' | 'outbound' } | null
  reply_to?: { message_id: number; preview: string; outbound: boolean } | null
  media_preview?: { url: string; mime?: string | null } | null
  campaign_preview?: CampaignMessagePreviewData | null
  campaign_id?: number | null
}

function mediaIcon(type: string): string {
  if (type === 'image') return '📷'
  if (type === 'video') return '🎬'
  if (type === 'audio' || type === 'voice') return '🎵'
  if (type === 'document') return '📎'
  if (type === 'sticker') return '🎭'
  if (type === 'campaign') return '📢'
  return '📎'
}

function mediaLabel(type: string): string {
  if (type === 'image') return 'Imagen'
  if (type === 'video') return 'Video'
  if (type === 'audio') return 'Audio'
  if (type === 'voice') return 'Nota de voz'
  if (type === 'document') return 'Documento'
  if (type === 'sticker') return 'Sticker'
  if (type === 'campaign') return 'Campaña'
  return type
}

function isMediaType(type: string): boolean {
  return ['image', 'video', 'audio', 'voice', 'document', 'sticker'].includes(type)
}

function resolveMediaUrl(url: string): string {
  const u = url.trim()
  if (/^https?:\/\//i.test(u)) return u
  return u.startsWith('/') ? u : `/${u}`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function highlightText(text: string, query: string): ReactNode {
  const q = query.trim()
  if (!q) return text
  const parts = text.split(new RegExp(`(${escapeRegExp(q)})`, 'gi'))
  if (parts.length === 1) return text
  return parts.map((part, index) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={index} className="chat-bubble__highlight">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

function messageAuthorLabel(message: ChatMessage, outbound: boolean): string | null {
  if (!outbound) return 'Cliente'
  if (message.is_ai) return 'IA'
  const mt = message.message_type.toLowerCase()
  if (mt === 'campaign' || message.campaign_preview || message.campaign_id) {
    return 'Campaña'
  }
  return 'Asesor'
}

type ChatMessageBubbleProps = {
  message: ChatMessage
  conversationId: number
  highlightQuery?: string
  isHighlighted?: boolean
  canInteract?: boolean
  onReply?: (message: ChatMessage) => void
  onCopy?: (message: ChatMessage) => void
  onReact?: (message: ChatMessage, emoji: string) => void
}

export function ChatMessageBubble({
  message,
  conversationId,
  highlightQuery = '',
  isHighlighted = false,
  canInteract = false,
  onReply,
  onCopy,
  onReact,
}: ChatMessageBubbleProps) {
  const outbound = message.direction === 'outbound'
  const mt = message.message_type.toLowerCase()
  const mediaUrl = message.media_preview?.url
    ? resolveMediaUrl(message.media_preview.url)
    : ''
  const mime = message.media_preview?.mime ?? ''
  const downloadHref = `/api/conversations/${conversationId}/messages/${message.id}/download`
  const showTypeRow =
    isMediaType(mt) || (mt === 'campaign' && !message.campaign_preview)
  const campPreview = message.campaign_preview
  const authorLabel = messageAuthorLabel(message, outbound)
  const copyText = message.body_text?.trim() ?? ''
  const showMenu = canInteract && (onReply || onCopy || onReact)

  const bubble = (
    <div
      id={`chat-msg-${message.id}`}
      className={cn(
        'chat-bubble',
        outbound ? 'chat-bubble--out' : 'chat-bubble--in',
        outbound && message.is_ai && 'chat-bubble--ai',
        isHighlighted && 'chat-bubble--search-hit',
        message.reaction?.emoji && 'chat-bubble--has-reaction',
      )}
    >
      {authorLabel ? (
        <span className="chat-bubble__author-tag" title={`Enviado por ${authorLabel}`}>
          {authorLabel === 'IA' ? <span aria-hidden="true">✨ </span> : null}
          {authorLabel}
        </span>
      ) : null}

      {message.reply_to ? (
        <div className="chat-bubble__reply-to">
          <span className="chat-bubble__reply-to-label">
            {message.reply_to.outbound ? 'Tú' : 'Cliente'}
          </span>
          <span className="chat-bubble__reply-to-text">{message.reply_to.preview}</span>
        </div>
      ) : null}

      {showTypeRow ? (
        <div className="chat-bubble__type" title={mediaLabel(mt) || mt}>
          <span className="chat-msg-type-icon" aria-hidden="true">
            {mediaIcon(mt)}
          </span>
          <span className="chat-msg-type-label">{mediaLabel(mt) || mt}</span>
        </div>
      ) : null}

      {campPreview ? (
        <ChatCampaignPreview preview={campPreview} campaignId={message.campaign_id} />
      ) : null}

      {mediaUrl && (mt === 'image' || mt === 'sticker') ? (
        <div className="chat-bubble__media">
          <img
            className="chat-msg-media chat-msg-media--img"
            src={mediaUrl}
            alt=""
            loading="lazy"
            decoding="async"
          />
          <a className="chat-msg-download-link" href={downloadHref}>
            Descargar
          </a>
        </div>
      ) : null}

      {mediaUrl && mt === 'video' ? (
        <div className="chat-bubble__media">
          <video
            className="chat-msg-media chat-msg-media--video"
            controls
            playsInline
            preload="metadata"
            src={mediaUrl}
          />
        </div>
      ) : null}

      {mediaUrl && (mt === 'audio' || mt === 'voice') ? (
        <div className="chat-bubble__media">
          <audio
            className="chat-msg-media chat-msg-media--audio"
            controls
            preload="metadata"
            src={mediaUrl}
          />
        </div>
      ) : null}

      {mediaUrl && mt === 'document' ? (
        <div className="chat-bubble__media chat-bubble__media--doc">
          {mime.includes('pdf') ? (
            <iframe
              className="chat-msg-media chat-msg-media--pdf"
              title="Vista PDF"
              src={mediaUrl}
            />
          ) : null}
          <a className="chat-msg-download-link" href={downloadHref}>
            Descargar
          </a>
          <a
            className="chat-msg-doc-link"
            href={mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Abrir
          </a>
        </div>
      ) : null}

      {isMediaType(mt) && !mediaUrl ? (
        <p className="chat-msg-fallback">
          {outbound
            ? 'Adjunto enviado (vista previa no disponible).'
            : 'No se pudo cargar la vista previa del archivo.'}
        </p>
      ) : null}

      {!campPreview && message.body_text?.trim() ? (
        <div className="chat-bubble__text">
          {highlightText(message.body_text, highlightQuery)}
        </div>
      ) : null}

      <div className="chat-bubble__meta">
        {formatDateTime(message.created_at)}
      </div>

      {message.reaction?.emoji ? (
        <span
          className={cn(
            'chat-bubble__reaction',
            outbound ? 'chat-bubble__reaction--out' : 'chat-bubble__reaction--in',
          )}
          title={
            message.reaction.direction === 'outbound'
              ? 'Tu reacción'
              : 'Reacción del cliente'
          }
        >
          {message.reaction.emoji}
        </span>
      ) : null}
    </div>
  )

  if (!showMenu) return bubble

  return (
    <ChatMessageBubbleMenu
      outbound={outbound}
      canInteract
      hasCopyText={Boolean(copyText)}
      onReply={() => onReply?.(message)}
      onCopy={() => onCopy?.(message)}
      onReact={(emoji) => onReact?.(message, emoji)}
    >
      {bubble}
    </ChatMessageBubbleMenu>
  )
}
