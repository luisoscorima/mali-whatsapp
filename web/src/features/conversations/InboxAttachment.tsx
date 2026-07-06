import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/shadcn/button'

type InboxAttachmentProps = {
  filename: string
  onRemove: () => void
  className?: string
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
