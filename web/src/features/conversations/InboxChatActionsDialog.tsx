import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/shared/api'
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
import { SegmentBadge } from '../segments/SegmentBadge'

type SegmentOption = {
  slug: string
  label: string
  color_key?: string
}

type InboxChatActionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: number | null
  heading: string
  phone: string
  contactId: number | null
  leadScore: number | null
  aiAreaEnabled: boolean
  conversationStatus: string | null
  canAssign: boolean
  assignableSegments: SegmentOption[]
  currentSegmentSlugs: string[]
  onLeadScore: (score: number | null) => void
  onMarkUnread: () => void
  onModeChange: (status: 'bot' | 'human') => void
  onExport: () => void
  onAssign: () => void
  onSegmentAdded?: () => void
}

export function InboxChatActionsDialog({
  open,
  onOpenChange,
  conversationId,
  heading,
  phone,
  contactId,
  leadScore,
  aiAreaEnabled,
  conversationStatus,
  canAssign,
  assignableSegments,
  currentSegmentSlugs,
  onLeadScore,
  onMarkUnread,
  onModeChange,
  onExport,
  onAssign,
  onSegmentAdded,
}: InboxChatActionsDialogProps) {
  const [segmentBusy, setSegmentBusy] = useState('')
  const [segmentError, setSegmentError] = useState('')
  const current = leadScore ?? 0
  const prefillPhone = phone.replace(/\D/g, '')
  const hasConversation = conversationId != null && conversationId > 0
  const status = String(conversationStatus ?? '').toLowerCase()
  const ownedSlugs = new Set(currentSegmentSlugs)

  async function addSegment(slug: string) {
    if (!contactId || ownedSlugs.has(slug)) return
    setSegmentBusy(slug)
    setSegmentError('')
    const res = await apiClient.post<{ updated: number }>(
      '/api/contacts/bulk-add-segment',
      { segment_slug: slug, contact_ids: [contactId] },
    )
    setSegmentBusy('')
    if (!res.ok) {
      setSegmentError(res.error)
      return
    }
    onSegmentAdded?.()
  }

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
          {!hasConversation ? (
            <p className="muted text-sm">
              Este contacto aún no tiene conversación. Abre el chat para escribir o guarda el contacto.
            </p>
          ) : null}

          {hasConversation && contactId && assignableSegments.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium">Asignar a:</p>
              <div className="flex flex-wrap gap-1">
                {assignableSegments.map((seg) => {
                  const owned = ownedSlugs.has(seg.slug)
                  return (
                    <button
                      key={seg.slug}
                      type="button"
                      disabled={owned || segmentBusy === seg.slug}
                      onClick={() => void addSegment(seg.slug)}
                      className="disabled:opacity-60"
                    >
                      <SegmentBadge colorKey={seg.color_key ?? 'slate'}>
                        {owned ? `✓ ${seg.label}` : seg.label}
                      </SegmentBadge>
                    </button>
                  )
                })}
              </div>
              {segmentError ? <p className="text-xs text-bad">{segmentError}</p> : null}
              <p className="muted text-xs">Solo añade segmentos; no quita los actuales.</p>
            </div>
          ) : null}

          {hasConversation && contactId ? (
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

          {hasConversation && aiAreaEnabled ? (
            <div className="inbox-mode-toggle" role="group" aria-label="Modo del chat">
              <span className="inbox-mode-toggle-label">Modo</span>
              <div className="inbox-mode-toggle-btns">
                {(['bot', 'human'] as const).map((mode) => (
                  <Button
                    key={mode}
                    type="button"
                    variant={status === mode ? 'default' : 'outline'}
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
            {hasConversation && canAssign ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-start"
                onClick={() => {
                  onAssign()
                  onOpenChange(false)
                }}
              >
                Asignar chat
              </Button>
            ) : null}
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
              disabled={!hasConversation}
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
              disabled={!hasConversation}
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
