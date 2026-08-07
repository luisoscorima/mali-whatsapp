import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { insertAtSelection, wrapSelection } from '@/shared/textSelection'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { Button } from '@/shared/ui/shadcn/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/shared/ui/shadcn/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { InboxAttachment } from './InboxAttachment'
import { InboxAdvisorNotesPopover } from './InboxAdvisorNotesPopover'
import { cn } from '@/lib/utils'

const COMMON_EMOJIS = [
  '😀', '😁', '😂', '😊', '😍', '😘', '🙂', '😉', '😎', '🤔',
  '👍', '👏', '🙏', '❤️', '🔥', '✅', '⭐', '🎉', '💬', '📎',
]

const ATTACH_OPTIONS = [
  { key: 'image', label: 'Imagen (JPEG/PNG)', accept: 'image/jpeg,image/png' },
  { key: 'video', label: 'Video (MP4)', accept: 'video/mp4' },
  { key: 'audio', label: 'Audio', accept: 'audio/mpeg,audio/mp3,audio/ogg,audio/aac,audio/mp4,audio/x-m4a,audio/m4a' },
  { key: 'pdf', label: 'PDF', accept: 'application/pdf' },
] as const

function IconAttach() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  )
}

function IconEmoji() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" y1="9" x2="9.01" y2="9" />
      <line x1="15" y1="9" x2="15.01" y2="9" />
    </svg>
  )
}

function IconPostIt() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
      <path
        fill="currentColor"
        opacity="0.2"
        d="M5.75 2h9.25L20 7.5v11.75A1.75 1.75 0 0 1 18.25 21H5.75A1.75 1.75 0 0 1 4 19.25V3.75A1.75 1.75 0 0 1 5.75 2z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 2.5H5.75A1.75 1.75 0 0 0 4 4.25v15A1.75 1.75 0 0 0 5.75 21h12.5A1.75 1.75 0 0 0 20 19.25V8L15 2.5z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15 2.5V8h5.5"
      />
      <path fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" d="M8 12.5h8M8 16h5" />
    </svg>
  )
}

function IconChevronDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export type ReplyToMessage = {
  id: number
  preview: string
  outbound: boolean
}

export type ReplyBlockedReason = '24h' | 'bot_mode' | null

type FlowOption = {
  id: number
  name: string
  status: string
  trigger_payload: string
}

type InboxComposeBarProps = {
  replyText: string
  onReplyTextChange: (value: string) => void
  replyFile: File | null
  onReplyFileChange: (file: File | null) => void
  sendingReply: boolean
  onSubmit: (e: FormEvent) => void
  replyTo?: ReplyToMessage | null
  onClearReplyTo?: () => void
  windowOpen: boolean
  canReply: boolean
  replyBlockedReason?: ReplyBlockedReason
  conversationId: number
  onOpenTemplate: () => void
  onSwitchToHuman?: () => void | Promise<void>
  onFlowStarted?: () => void
  contactAttributes?: Record<string, string>
  notesTrigger?: ReactNode
}

export function InboxComposeBar({
  replyText,
  onReplyTextChange,
  replyFile,
  onReplyFileChange,
  sendingReply,
  onSubmit,
  replyTo,
  onClearReplyTo,
  windowOpen,
  canReply,
  replyBlockedReason = null,
  conversationId,
  onOpenTemplate,
  onSwitchToHuman,
  onFlowStarted,
  contactAttributes = {},
}: InboxComposeBarProps) {
  const { confirm, confirmDialog } = useConfirmDialog()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [fileAccept, setFileAccept] = useState<string>(ATTACH_OPTIONS[0].accept)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [flows, setFlows] = useState<FlowOption[]>([])
  const [flowBusy, setFlowBusy] = useState(false)

  useEffect(() => {
    if (!windowOpen) return
    apiClient.get<FlowOption[]>('/api/flows').then((res) => {
      if (res.ok) setFlows(res.data.filter((f) => f.status === 'active'))
    })
  }, [windowOpen, conversationId])

  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = '0px'
    const next = Math.min(Math.max(el.scrollHeight, 36), 160)
    el.style.height = `${next}px`
  }, [replyText, canReply])

  function pickAttachment(accept: string) {
    setFileAccept(accept)
    requestAnimationFrame(() => fileInputRef.current?.click())
  }

  function insertEmoji(emoji: string) {
    insertAtSelection(textareaRef.current, emoji, replyText, onReplyTextChange)
    setEmojiOpen(false)
  }

  function applyFormat(marker: string) {
    wrapSelection(textareaRef.current, marker, replyText, onReplyTextChange)
  }

  async function startFlow(flowId: number, flowName: string) {
    const ok = await confirm({
      title: 'Iniciar flujo',
      description: `Se iniciará el flujo «${flowName}» en este chat. El cliente recibirá el mensaje del flujo de inmediato.`,
      confirmLabel: 'Iniciar flujo',
    })
    if (!ok) return

    setFlowBusy(true)
    const result = await apiClient.post<{ flow_id: number; flow_name: string }>(
      `/api/conversations/${conversationId}/start-flow`,
      { flow_id: flowId },
    )
    setFlowBusy(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success(`Flujo «${result.data.flow_name}» iniciado`)
    onFlowStarted?.()
  }

  function onTextareaKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter') return
    if (event.shiftKey) return
    event.preventDefault()
    if (sendingReply || !canReply) return
    const form = event.currentTarget.form
    if (form) form.requestSubmit()
  }

  const blockedByBot = !canReply && replyBlockedReason === 'bot_mode'
  const blockedByWindow = !canReply && !blockedByBot
  const hasSecondary = canReply && (windowOpen ? flows.length > 0 : true)

  return (
    <>
      <form
        onSubmit={(e) => {
          if (!canReply) {
            e.preventDefault()
            return
          }
          onSubmit(e)
        }}
        className="inbox-compose-stack inbox-compose-stack--with-emoji"
      >
        {replyTo && canReply ? (
          <div className="inbox-compose-reply-to">
            <div className="inbox-compose-reply-to__body">
              <span className="inbox-compose-reply-to__label">
                Respondiendo a {replyTo.outbound ? 'ti' : 'cliente'}
              </span>
              <span className="inbox-compose-reply-to__text">{replyTo.preview}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Cancelar respuesta"
              title="Cancelar respuesta"
              onClick={() => onClearReplyTo?.()}
            >
              ×
            </Button>
          </div>
        ) : null}
        {replyFile && canReply ? (
          <InboxAttachment filename={replyFile.name} onRemove={() => onReplyFileChange(null)} />
        ) : null}

        {!canReply ? (
          <div className="flex flex-col gap-2 px-1 pb-1">
            <p className="text-xs text-muted">
              {blockedByBot
                ? 'Este chat está en modo Bot. Pásalo a Asesor para escribir libremente.'
                : windowOpen
                  ? 'No puedes escribir libremente ahora; inicia un flujo o envía una plantilla.'
                  : 'Ventana de 24 h cerrada; envía una plantilla para reabrir la conversación.'}
            </p>
            <div className="flex flex-wrap gap-2">
              {blockedByBot && onSwitchToHuman ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => void onSwitchToHuman()}
                >
                  Pasar a Asesor
                </Button>
              ) : null}
              {blockedByWindow ? (
                <Button type="button" size="sm" onClick={() => onOpenTemplate()}>
                  Enviar plantilla
                </Button>
              ) : null}
              {!blockedByBot && windowOpen && flows.length > 0 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" variant="secondary" disabled={flowBusy}>
                      Iniciar flujo
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-w-xs">
                    {flows.map((f) => (
                      <DropdownMenuItem
                        key={f.id}
                        disabled={flowBusy}
                        onSelect={() => void startFlow(f.id, f.name)}
                      >
                        <span className="flex flex-col gap-0.5">
                          <span>{f.name}</span>
                          <span className="font-mono text-[10px] text-muted">
                            {f.trigger_payload}
                          </span>
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          </div>
        ) : null}

        <div className="inbox-compose-bar">
          {canReply ? (
            <>
              <div className="inbox-compose-tools">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" title="Adjuntar archivo">
                      <IconAttach />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {ATTACH_OPTIONS.map((opt) => (
                      <DropdownMenuItem key={opt.key} onSelect={() => pickAttachment(opt.accept)}>
                        {opt.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={fileAccept}
                  className="sr-only"
                  onChange={(e) => onReplyFileChange(e.target.files?.[0] ?? null)}
                />

                <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                  <PopoverTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" aria-label="Insertar emoji" title="Emoji">
                      <IconEmoji />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-auto p-2">
                    <div className="grid grid-cols-5 gap-1">
                      {COMMON_EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="rounded-md px-1 py-0.5 text-lg hover:bg-accent-soft"
                          onClick={() => insertEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Negrita"
                  aria-label="Negrita"
                  onClick={() => applyFormat('*')}
                >
                  <strong>B</strong>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Cursiva"
                  aria-label="Cursiva"
                  onClick={() => applyFormat('_')}
                >
                  <em>I</em>
                </Button>
              </div>

              <textarea
                ref={textareaRef}
                value={replyText}
                onChange={(e) => onReplyTextChange(e.target.value)}
                onKeyDown={onTextareaKeyDown}
                rows={1}
                placeholder="Escribe un mensaje…"
                className="inbox-compose-textarea inbox-compose-grow"
              />

              <div className="inbox-compose-actions">
                <InboxAdvisorNotesPopover
                  triggerIcon={<IconPostIt />}
                  contactAttributes={contactAttributes}
                  onInsert={(text) =>
                    insertAtSelection(textareaRef.current, text, replyText, onReplyTextChange)
                  }
                />

                <div className="inbox-compose-send-split">
                  <Button
                    type="submit"
                    disabled={sendingReply || !canReply}
                    className={cn(
                      'inbox-compose-send',
                      hasSecondary ? 'inbox-compose-send--split-main' : '',
                    )}
                  >
                    {sendingReply ? '…' : 'Enviar'}
                  </Button>
                  {hasSecondary ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          disabled={flowBusy}
                          className="inbox-compose-send inbox-compose-send--split-more"
                          aria-label="Más acciones de envío"
                          title="Más acciones"
                        >
                          <IconChevronDown />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="max-w-xs">
                        {windowOpen
                          ? flows.map((f) => (
                              <DropdownMenuItem
                                key={f.id}
                                disabled={flowBusy}
                                onSelect={() => void startFlow(f.id, f.name)}
                              >
                                <span className="flex flex-col gap-0.5">
                                  <span>Iniciar flujo: {f.name}</span>
                                  <span className="font-mono text-[10px] text-muted">
                                    {f.trigger_payload}
                                  </span>
                                </span>
                              </DropdownMenuItem>
                            ))
                          : (
                              <DropdownMenuItem onSelect={() => onOpenTemplate()}>
                                Enviar plantilla
                              </DropdownMenuItem>
                            )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              </div>
            </>
          ) : (
            <div className="inbox-compose-grow min-h-[36px]" />
          )}
        </div>

        {canReply ? (
          <p className="inbox-compose-hint-inline muted">
            ⏎ envía · ⇧⏎ nueva línea. WhatsApp: *negrita*, _cursiva_. JPEG/PNG (5 MB), MP4 (16 MB), audio (16 MB), PDF (25 MB).
          </p>
        ) : null}
      </form>
      {confirmDialog}
    </>
  )
}
