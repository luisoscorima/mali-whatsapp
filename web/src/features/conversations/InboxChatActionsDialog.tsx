import { Link } from 'react-router-dom'
import { Button } from '@/shared/ui/shadcn/button'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'

type InboxChatActionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  heading: string
  phone: string
  contactId: number | null
  leadScore: number | null
  aiAreaEnabled: boolean
  conversationStatus: string
  onLeadScore: (score: number | null) => void
  onMarkUnread: () => void
  onModeChange: (status: 'bot' | 'human') => void
  onExport: () => void
}

export function InboxChatActionsDialog({
  open,
  onOpenChange,
  heading,
  phone,
  contactId,
  leadScore,
  aiAreaEnabled,
  conversationStatus,
  onLeadScore,
  onMarkUnread,
  onModeChange,
  onExport,
}: InboxChatActionsDialogProps) {
  const current = leadScore ?? 0
  const prefillPhone = phone.replace(/\D/g, '')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(96vw,400px)]">
        <DialogHeader>
          <DialogTitle>Opciones del chat</DialogTitle>
          <DialogDescription>
            {heading} · {phone}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-4">
          {contactId ? (
            <div className="inbox-lead-score-form">
              <div className="inbox-lead-score-row">
                <span className="inbox-lead-score-label" id="inbox-actions-lead-label">
                  Calificación del lead
                </span>
                <div
                  className="inbox-lead-stars-input"
                  role="group"
                  aria-labelledby="inbox-actions-lead-label"
                >
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`inbox-lead-star-btn ${n <= current ? 'is-on' : ''}`}
                      onClick={() => void onLeadScore(n)}
                      aria-label={`${n} estrella${n > 1 ? 's' : ''}`}
                    >
                      ★
                    </button>
                  ))}
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
          ) : null}

          {aiAreaEnabled ? (
            <div className="inbox-mode-toggle" role="group" aria-label="Modo del chat">
              <span className="inbox-mode-toggle-label">Modo</span>
              <div className="inbox-mode-toggle-btns">
                {(['bot', 'human'] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant={conversationStatus === mode ? 'default' : 'outline'}
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
          ) : null}

          <div className="flex flex-col gap-2">
            {contactId ? (
              <Link
                to={`/contacts/${contactId}`}
                className="inline-flex w-full items-center justify-start rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-accent-soft"
                onClick={() => onOpenChange(false)}
              >
                Ir a perfil
              </Link>
            ) : (
              <Link
                to={`/contacts/new?prefill_phone=${encodeURIComponent(prefillPhone)}`}
                className="inline-flex w-full items-center justify-start rounded-md border border-line bg-surface px-3 py-2 text-sm hover:bg-accent-soft"
                onClick={() => onOpenChange(false)}
              >
                Guardar contacto
              </Link>
            )}
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-start"
              onClick={() => {
                onExport()
                onOpenChange(false)
              }}
            >
              Descargar Excel
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="w-full justify-start"
              onClick={() => {
                onMarkUnread()
                onOpenChange(false)
              }}
            >
              Marcar como no leído
            </Button>
          </div>
        </DialogBody>
        <DialogFooter>
          <DialogClose>Cerrar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
