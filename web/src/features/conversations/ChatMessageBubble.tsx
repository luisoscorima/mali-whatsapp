import { formatDateTime } from '@/shared/format'
import { Badge } from '@/shared/ui/shadcn/badge'
import { Bubble, BubbleContent } from '@/shared/ui/shadcn/bubble'
import { Message, MessageContent, MessageFooter } from '@/shared/ui/shadcn/message'
import { cn } from '@/lib/utils'

export type ChatMessage = {
  id: number
  direction: string
  body_text: string | null
  message_type: string
  created_at: string
  is_ai: boolean
  has_downloadable_media: boolean
  media_preview?: { url: string; mime?: string | null } | null
}

function mediaIcon(type: string): string {
  if (type === 'image') return '📷'
  if (type === 'video') return '🎬'
  if (type === 'audio' || type === 'voice') return '🎵'
  if (type === 'document') return '📎'
  if (type === 'sticker') return '🎭'
  return '📎'
}

function mediaLabel(type: string): string {
  if (type === 'image') return 'Imagen'
  if (type === 'video') return 'Video'
  if (type === 'audio') return 'Audio'
  if (type === 'voice') return 'Nota de voz'
  if (type === 'document') return 'Documento'
  if (type === 'sticker') return 'Sticker'
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

type ChatMessageBubbleProps = {
  message: ChatMessage
  conversationId: number
}

export function ChatMessageBubble({ message, conversationId }: ChatMessageBubbleProps) {
  const outbound = message.direction === 'outbound'
  const align = outbound ? 'end' : 'start'
  const variant = outbound ? 'default' : 'secondary'
  const mt = message.message_type.toLowerCase()
  const mediaUrl = message.media_preview?.url
    ? resolveMediaUrl(message.media_preview.url)
    : ''
  const mime = message.media_preview?.mime ?? ''
  const downloadHref = `/api/conversations/${conversationId}/messages/${message.id}/download`
  const showTypeRow = isMediaType(mt)

  return (
    <Message align={align}>
      <MessageContent>
        <Bubble variant={variant} align={align} dashed={message.is_ai}>
          {outbound && message.is_ai ? (
            <Badge variant="secondary" className="mb-1 normal-case">
              ✨ IA
            </Badge>
          ) : null}

          {showTypeRow ? (
            <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted">
              <span aria-hidden="true">{mediaIcon(mt)}</span>
              {mediaLabel(mt)}
            </p>
          ) : null}

          {mediaUrl && (mt === 'image' || mt === 'sticker') ? (
            <div className="mb-2 overflow-hidden rounded-lg border border-line">
              <img
                className="chat-msg-media chat-msg-media--img"
                src={mediaUrl}
                alt=""
                loading="lazy"
                decoding="async"
              />
              <div className="border-t border-line px-2 py-1">
                <a href={downloadHref} className={cn('text-xs font-medium text-accent hover:underline')}>
                  Descargar
                </a>
              </div>
            </div>
          ) : null}

          {mediaUrl && mt === 'video' ? (
            <video
              className="chat-msg-media chat-msg-media--video mb-2 rounded-lg"
              controls
              playsInline
              preload="metadata"
              src={mediaUrl}
            />
          ) : null}

          {mediaUrl && (mt === 'audio' || mt === 'voice') ? (
            <audio
              className="chat-msg-media chat-msg-media--audio mb-2 w-full"
              controls
              preload="metadata"
              src={mediaUrl}
            />
          ) : null}

          {mediaUrl && mt === 'document' ? (
            <div className="mb-2 space-y-1 rounded-lg border border-line p-2">
              {mime.includes('pdf') ? (
                <iframe
                  className="chat-msg-media chat-msg-media--pdf w-full rounded"
                  title="Vista PDF"
                  src={mediaUrl}
                />
              ) : null}
              <div className="flex flex-wrap gap-2">
                <a href={downloadHref} className="text-xs font-medium text-accent hover:underline">
                  Descargar
                </a>
                <a
                  href={mediaUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-medium text-accent hover:underline"
                >
                  Abrir
                </a>
              </div>
            </div>
          ) : null}

          {isMediaType(mt) && !mediaUrl ? (
            <p className="mb-1 text-xs text-muted">
              {outbound
                ? 'Adjunto enviado (vista previa no disponible).'
                : 'No se pudo cargar la vista previa del archivo.'}
            </p>
          ) : null}

          {message.body_text?.trim() ? (
            <BubbleContent className="whitespace-pre-wrap text-[0.92rem] leading-relaxed">
              {message.body_text}
            </BubbleContent>
          ) : null}
        </Bubble>
        <MessageFooter>
          {formatDateTime(message.created_at)}
          {message.is_ai ? ' · IA' : ''}
        </MessageFooter>
      </MessageContent>
    </Message>
  )
}
