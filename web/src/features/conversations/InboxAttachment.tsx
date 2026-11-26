import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/shadcn/button'
import { ChatAudioPlayer } from './ChatAudioPlayer'

type InboxAttachmentProps = {
  filename: string
  onRemove: () => void
  className?: string
}

export type InboxReplyAttachment = { file: File; voiceNote?: boolean }

export function InboxTrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />
    </svg>
  )
}

export function InboxVoiceAttachment({
  file,
  onRemove,
  embedded = false,
  fadingOut = false,
}: {
  file: File
  onRemove: () => void
  embedded?: boolean
  fadingOut?: boolean
}) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  const player = url ? (
    <ChatAudioPlayer src={url} />
  ) : (
    <span className="text-sm text-muted">Nota de voz</span>
  )

  if (embedded) {
    return (
      <div
        className={cn(
          'inbox-compose-voice-preview inbox-compose-grow flex w-full min-w-0 items-center gap-2',
          fadingOut ? 'inbox-compose-fade-out' : 'inbox-compose-fade',
        )}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full text-muted"
          aria-label="Descartar nota de voz"
          title="Descartar nota de voz"
          disabled={fadingOut}
          onClick={onRemove}
        >
          <InboxTrashIcon />
        </Button>
        <div className="min-w-0 flex-1">{player}</div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-strong px-3 py-2">
      <div className="min-w-0 flex-1">{player}</div>
      <Button
        type="button" variant="ghost" size="icon" className="rounded-full text-muted"
        aria-label="Descartar nota de voz" title="Descartar nota de voz" onClick={onRemove}
      >
        <InboxTrashIcon />
      </Button>
    </div>
  )
}

export function InboxAttachment({ filename, onRemove, className }: InboxAttachmentProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm',
        className,
      )}
    >
      <span className="min-w-0 truncate">
        <span className="text-muted">Adjunto:</span> {filename}
      </span>
      <Button
        type="button" variant="ghost" size="icon" className="rounded-full text-muted"
        aria-label="Quitar adjunto" title="Quitar adjunto" onClick={onRemove}
      >
        <InboxTrashIcon />
      </Button>
    </div>
  )
}
