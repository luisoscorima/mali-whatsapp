import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { formatDateTime } from '@/shared/format'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { Button } from '@/shared/ui/shadcn/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'

type ScheduledMessage = {
  id: number
  body_text: string | null
  message_type: string
  scheduled_at?: string | null
  created_at: string
}

type InboxScheduledMessagesDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: number
  onCancelled?: (messageId: number) => void
}

export function InboxScheduledMessagesDialog({
  open,
  onOpenChange,
  conversationId,
  onCancelled,
}: InboxScheduledMessagesDialogProps) {
  const { confirm, confirmDialog } = useConfirmDialog()
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<ScheduledMessage[]>([])
  const [cancellingId, setCancellingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!conversationId) return
    setLoading(true)
    const result = await apiClient.get<ScheduledMessage[]>(
      `/api/conversations/${conversationId}/scheduled-messages`,
    )
    setLoading(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setItems(result.data)
  }, [conversationId])

  useEffect(() => {
    if (!open) return
    void load()
  }, [open, load])

  async function cancelOne(messageId: number) {
    if (
      !(await confirm({
        title: 'Cancelar mensaje programado',
        description: '¿Cancelar este mensaje? No se enviará.',
        confirmLabel: 'Cancelar envío',
        tone: 'danger',
      }))
    ) {
      return
    }
    setCancellingId(messageId)
    const result = await apiClient.delete<{ deleted: true }>(
      `/api/conversations/${conversationId}/scheduled-messages/${messageId}`,
    )
    setCancellingId(null)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setItems((prev) => prev.filter((m) => m.id !== messageId))
    onCancelled?.(messageId)
    notify.success('Mensaje programado cancelado')
  }

  return (
    <>
      {confirmDialog}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[min(96vw,480px)]">
          <DialogHeader className="flex items-center justify-between gap-3">
            <DialogTitle>Mensajes programados</DialogTitle>
            <DialogClose className="border-0 px-2">✕</DialogClose>
          </DialogHeader>
          <DialogBody className="space-y-3">
            {loading ? (
              <p className="text-sm text-muted">Cargando…</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-muted">No hay mensajes programados.</p>
            ) : (
              <ul className="space-y-2">
                {items.map((msg) => (
                  <li
                    key={msg.id}
                    className="rounded-lg border border-line bg-surface px-3 py-2"
                  >
                    <p className="text-xs text-muted">
                      {msg.scheduled_at
                        ? formatDateTime(msg.scheduled_at)
                        : formatDateTime(msg.created_at)}
                    </p>
                    <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap">
                      {msg.body_text?.trim() || `[${msg.message_type}]`}
                    </p>
                    <div className="mt-2 flex justify-end">
                      <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        className="text-bad"
                        title="Cancelar mensaje"
                        aria-label="Cancelar mensaje"
                        disabled={cancellingId === msg.id}
                        onClick={() => void cancelOne(msg.id)}
                      >
                        {cancellingId === msg.id ? (
                          '…'
                        ) : (
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
                            <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5m4-5v5" />
                          </svg>
                        )}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
    </>
  )
}
