import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/shadcn/button'

type InboxAttachmentProps = {
  filename: string
  onRemove: () => void
  className?: string
}

export type InboxReplyAttachment = { file: File; voiceNote?: boolean }

export function InboxVoiceAttachment({ file, onRemove }: { file: File; onRemove: () => void }) {
  const [url, setUrl] = useState('')

  useEffect(() => {
    const next = URL.createObjectURL(file)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [file])

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-strong px-3 py-2">
      <span className="text-sm font-medium">Nota de voz</span>
      {url && (
        <audio src={url} controls preload="metadata" aria-label="Escuchar nota de voz" className="h-9 min-w-36 max-w-80 flex-1" />
      )}
      <Button type="button" variant="ghost" size="sm" className="ml-auto" onClick={onRemove}>
        Quitar
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
      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
        Quitar
      </Button>
    </div>
  )
}
