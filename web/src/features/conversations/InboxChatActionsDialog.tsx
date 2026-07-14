import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { useTheme } from '@/shared/theme/useTheme'
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
import { segmentFilterPillStyle } from '../segments/segmentColors'

type SegmentOption = {
  slug: string
  label: string
  color_key?: string
  assignment_group?: string | null
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
  const { theme } = useTheme()
  const [segmentBusy, setSegmentBusy] = useState('')
  const current = leadScore ?? 0
  const prefillPhone = phone.replace(/\D/g, '')
  const hasConversation = conversationId != null && conversationId > 0
  const status = String(conversationStatus ?? '').toLowerCase()
  const assignableSlugs = new Set(assignableSegments.map((seg) => seg.slug))
  const activeAssignableSlugs = new Set(
    currentSegmentSlugs.filter((slug) => assignableSlugs.has(slug)),
  )

  const groupedAssignable = useMemo(() => {
    const groups = new Map<string, SegmentOption[]>()
    for (const seg of assignableSegments) {
      const key = (seg.assignment_group ?? '').trim() || 'sin_grupo'
      const list = groups.get(key) ?? []
      list.push(seg)
      groups.set(key, list)
    }
    return [...groups.entries()]
  }, [assignableSegments])

  async function toggleAssignableSegment(slug: string) {
    if (!contactId) return
    setSegmentBusy(slug)
    const res = await apiClient.patch<{ segment_slugs: string[] }>(
      `/api/contacts/${contactId}/assignable-segment`,
      { segment_slug: slug },
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
            <div className="space-y-3">
              <p className="text-sm font-medium">Asignar a:</p>
              {groupedAssignable.map(([group, segs]) => (
                <div key={group} className="space-y-1">
                  <p className="text-xs text-muted">{group}:</p>
                  <div
                    className="flex flex-wrap gap-1"
                    role="group"
                    aria-label={`Asignar a ${group}`}
                  >
                    {segs.map((seg) => {
                      const active = activeAssignableSlugs.has(seg.slug)
                      return (
                        <button
                          key={seg.slug}
                          type="button"
                          role="checkbox"
                          aria-checked={active}
                          disabled={segmentBusy === seg.slug}
                          onClick={() => void toggleAssignableSegment(seg.slug)}
                          className={`inbox-chat-pill contact-filter-pill ${active ? 'is-active' : ''}`}
                          style={segmentFilterPillStyle(
                            seg.color_key ?? 'slate',
                            theme,
                            active,
                          )}
                        >
                          {seg.label}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
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
                to={`/contacts/new?prefill_phone=${encodeURIComponent(prefillPhone)}${
                  hasConversation
                    ? `&return_to=${encodeURIComponent(`/conversations/${conversationId}`)}`
                    : ''
                }`}
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
