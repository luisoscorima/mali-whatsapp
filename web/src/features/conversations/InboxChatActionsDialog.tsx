import { useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
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
import { AssignableSegmentsAccordion } from './assignableSegmentsUi'
import { chatSecondaryLabel } from './whatsappIdentity'
import { LEAD_SCORE_OPTIONS } from './leadScore'

type SegmentOption = {
  slug: string
  label: string
  color_key?: string
  assignment_group?: string | null
  category?: string
}

type InboxChatActionsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  conversationId: number | null
  heading: string
  phone: string
  contactId: number | null
  leadScore: number | null
  leadStatusId: number | null
  leadStatusLabel: string | null
  aiAreaEnabled: boolean
  conversationStatus: string | null
  assignableSegments: SegmentOption[]
  category?: string | null
  currentSegmentSlugs: string[]
  onLeadScore: (score: number | null) => void
  onMarkUnread: () => void
  onSetArchived?: (archived: boolean) => void
  archived?: boolean
  lastUserMessageAt?: string | null
  onModeChange: (status: 'bot' | 'human') => void
  onExport: () => void
  canAssign?: boolean
  onAssign?: () => void
  onOpenLeadStatus?: () => void
  onOpenContact: () => void
  canOpenContact?: boolean
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
  leadStatusId,
  leadStatusLabel,
  aiAreaEnabled,
  conversationStatus,
  assignableSegments,
  category = null,
  currentSegmentSlugs,
  onLeadScore,
  onMarkUnread,
  onSetArchived,
  archived = false,
  lastUserMessageAt = null,
  onModeChange,
  onExport,
  canAssign = false,
  onAssign,
  onOpenLeadStatus,
  onOpenContact,
  canOpenContact = true,
  onSegmentAdded,
}: InboxChatActionsDialogProps) {
  const [segmentBusy, setSegmentBusy] = useState('')
  const current = leadScore ?? 0
  const hasConversation = conversationId != null && conversationId > 0
  const status = String(conversationStatus ?? '').toLowerCase()
  const hasInbound = lastUserMessageAt != null
  const canUnarchive = archived && hasInbound
  const canArchive = hasConversation && hasInbound && !archived

  async function toggleAssignableSegment(slug: string) {
    if (!contactId) return
    setSegmentBusy(slug)
    const res = await apiClient.patch<{ segment_slugs: string[] }>(
      `/api/contacts/${contactId}/assignable-segment`,
      { segment_slug: slug, category: category || undefined },
    )
    setSegmentBusy('')
    if (!res.ok) {
      notify.error(res.error)
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
            {heading} · {chatSecondaryLabel(phone)}
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
              <AssignableSegmentsAccordion
                assignableSegments={assignableSegments}
                category={category}
                currentSegmentSlugs={currentSegmentSlugs}
                busySlug={segmentBusy}
                onToggle={(slug) => void toggleAssignableSegment(slug)}
              />
            </div>
          ) : null}

          {hasConversation && contactId ? (
            <div className="inbox-lead-score-form">
              <div className="inbox-lead-score-row">
                <span className="inbox-lead-score-label" id="inbox-actions-lead-label">
                  Calificación del lead
                </span>
                <div
                  className="inbox-lead-score-input"
                  role="group"
                  aria-labelledby="inbox-actions-lead-label"
                >
                  {LEAD_SCORE_OPTIONS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      className={`inbox-lead-score-pick inbox-lead-score-pick--${
                        value === 1 ? 'low' : value === 2 ? 'mid' : 'high'
                      } ${current === value ? 'is-on' : ''}`}
                      onClick={() => void onLeadScore(value)}
                      aria-pressed={current === value}
                    >
                      {label}
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
            {hasConversation && canAssign && onAssign ? (
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
            {hasConversation && contactId && onOpenLeadStatus ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-start"
                onClick={() => {
                  onOpenLeadStatus()
                  onOpenChange(false)
                }}
              >
                Estado del lead
                {leadStatusLabel ? (
                  <span className="muted ml-auto text-xs font-normal">
                    {leadStatusLabel}
                  </span>
                ) : null}
              </Button>
            ) : null}
            {canOpenContact ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-start"
                onClick={() => {
                  onOpenContact()
                  onOpenChange(false)
                }}
              >
                {contactId ? 'Editar contacto' : 'Guardar contacto'}
              </Button>
            ) : null}
            {canArchive && onSetArchived ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-start"
                onClick={() => {
                  onSetArchived(true)
                  onOpenChange(false)
                }}
              >
                Archivar chat
              </Button>
            ) : null}
            {canUnarchive && onSetArchived ? (
              <Button
                type="button"
                variant="secondary"
                className="w-full justify-start"
                onClick={() => {
                  onSetArchived(false)
                  onOpenChange(false)
                }}
              >
                Desarchivar chat
              </Button>
            ) : null}
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
