import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
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

function IconNotes() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="13" y2="17" />
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
  conversationId: number
  onOpenTemplate: () => void
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
  conversationId,
  onOpenTemplate,
  onFlowStarted,
  contactAttributes = {},
}: InboxComposeBarProps) {
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

  async function startFlow(flowId: number) {
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

  const showTextarea = canReply
  const hasSecondary = windowOpen ? flows.length > 0 : true

  return (
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
        <p className="text-xs text-muted px-1 pb-1">
          {windowOpen
            ? 'No puedes escribir libremente ahora; puedes iniciar un flujo desde la flecha.'
            : 'Ventana de 24 h cerrada; envía una plantilla desde la flecha.'}
        </p>
      ) : null}

      <div className="inbox-compose-bar">
        {canReply ? (
          <>
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

            <InboxAdvisorNotesPopover
              triggerIcon={<IconNotes />}
              contactAttributes={contactAttributes}
              onInsert={(text) =>
                insertAtSelection(textareaRef.current, text, replyText, onReplyTextChange)
              }
            />

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

            <textarea
              ref={textareaRef}
              value={replyText}
              onChange={(e) => onReplyTextChange(e.target.value)}
              rows={2}
              placeholder="Escribe un mensaje…"
              className="inbox-compose-textarea inbox-compose-grow"
            />
          </>
        ) : (
          <div className="inbox-compose-grow min-h-[36px]" />
        )}

        <div className="inbox-compose-send-split flex shrink-0">
          <Button
            type="submit"
            disabled={sendingReply || !canReply}
            className={cn(
              'inbox-compose-send rounded-r-none',
              hasSecondary ? 'pr-3' : '',
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
                  className="inbox-compose-send rounded-l-none border-l border-white/25 px-2"
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
                        onSelect={() => void startFlow(f.id)}
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

      {showTextarea ? (
        <p className="inbox-compose-hint-inline muted">
          WhatsApp: *negrita*, _cursiva_. JPEG/PNG (5 MB), MP4 (16 MB), audio (16 MB), PDF (25 MB).
        </p>
      ) : null}
    </form>
  )
}
