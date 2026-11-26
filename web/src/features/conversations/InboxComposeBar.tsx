import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
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
import { InboxAttachment, InboxVoiceAttachment, type InboxReplyAttachment } from './InboxAttachment'
import { InboxAdvisorNotesPopover } from './InboxAdvisorNotesPopover'
import { resolveNotePlaceholders, useAdvisorNotes } from './advisorNotes'
import { useInboxTyping } from './useInboxTyping'
import { useVoiceRecorder } from './useVoiceRecorder'
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

function IconMicrophone() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <rect x="9" y="2.5" width="6" height="12" rx="3" />
      <path d="M5 10.5v1a7 7 0 0 0 14 0v-1M12 18.5v3" />
    </svg>
  )
}

function IconSend() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 3l-6.5 18-3.6-7.9L3 9.5 21 3ZM10.9 13.1 21 3" />
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

function normalizeNoteSearch(text: string) {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

type InboxComposeBarProps = {
  replyText: string
  onReplyTextChange: (value: string) => void
  replyFile: InboxReplyAttachment | null
  onReplyFileChange: (attachment: InboxReplyAttachment | null) => void
  sendingReply: boolean
  onSubmit: (e: FormEvent) => void
  replyTo?: ReplyToMessage | null
  onClearReplyTo?: () => void
  windowOpen: boolean
  canReply: boolean
  replyBlockedReason?: ReplyBlockedReason
  conversationId: number
  typingAdvisorId?: number
  canSendTemplate: boolean
  onOpenTemplate: () => void
  onSwitchToHuman?: () => void | Promise<void>
  onFlowStarted?: () => void
  contactAttributes?: Record<string, string>
  contactName?: string
  contactPhone?: string
  contactEmail?: string
  contactDni?: string
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
  typingAdvisorId,
  canSendTemplate,
  onOpenTemplate,
  onSwitchToHuman,
  onFlowStarted,
  contactAttributes = {},
  contactName = '',
  contactPhone = '',
  contactEmail = '',
  contactDni = '',
}: InboxComposeBarProps) {
  const { confirm, confirmDialog } = useConfirmDialog()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const quickRepliesRef = useRef<HTMLDivElement>(null)
  const primaryActionRef = useRef<HTMLButtonElement>(null)
  const cancelRecordingRef = useRef<HTMLButtonElement>(null)
  const stopRecordingRef = useRef<HTMLButtonElement>(null)
  const wasRecording = useRef(false)
  const [fileAccept, setFileAccept] = useState<string>(ATTACH_OPTIONS[0].accept)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [flows, setFlows] = useState<FlowOption[]>([])
  const [flowBusy, setFlowBusy] = useState(false)
  const { notes, loading: notesLoading, loadNotes } = useAdvisorNotes()
  const voice = useVoiceRecorder(canReply, (file) => onReplyFileChange({ file, voiceNote: true }))
  const recording = voice.status !== 'idle'
  const hasOutgoing = Boolean(replyText.trim() || replyFile)
  const showSend = hasOutgoing || sendingReply
  const primaryLabel = sendingReply ? 'Enviando'
    : !hasOutgoing ? 'Grabar audio'
      : replyFile?.voiceNote ? 'Enviar nota de voz' : 'Enviar mensaje'
  const { names: typingNames, signalTyping, stopTyping } = useInboxTyping(
    conversationId > 0 ? conversationId : null,
    typingAdvisorId,
  )
  const [slash, setSlash] = useState<{ start: number; end: number; query: string } | null>(null)
  const [activeNote, setActiveNote] = useState(0)
  const notesListId = useId()
  const showNotes = canReply && slash != null

  function resolveText(text: string) {
    return resolveNotePlaceholders(text, contactAttributes, {
      name: contactName, phone: contactPhone, email: contactEmail, dni: contactDni,
    })
  }

  const quickReplies = slash == null ? [] : (() => {
    const terms = normalizeNoteSearch(slash.query).trim().split(/\s+/).filter(Boolean)
    return notes.map((note) => ({ ...note, preview: resolveText(note.body) }))
      .filter((note) => {
        const text = normalizeNoteSearch(`${note.title} ${note.body} ${note.preview}`)
        return note.preview.trim() && terms.every((term) => text.includes(term))
      })
      .slice(0, 8)
  })()
  const selectedNote = quickReplies[Math.min(activeNote, quickReplies.length - 1)]

  useEffect(() => {
    if (showNotes) void loadNotes()
  }, [showNotes, loadNotes])

  useEffect(() => {
    if (voice.status === 'requesting') cancelRecordingRef.current?.focus()
    if (voice.status === 'recording') stopRecordingRef.current?.focus()
    if (voice.status === 'finishing') cancelRecordingRef.current?.focus()
    if (voice.status === 'idle' && wasRecording.current) primaryActionRef.current?.focus()
    wasRecording.current = voice.status !== 'idle'
  }, [voice.status])

  useEffect(() => {
    if (showNotes) {
      quickRepliesRef.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' })
    }
  }, [showNotes, selectedNote?.id])

  function updateQuickReplies(textarea: HTMLTextAreaElement) {
    const { value, selectionStart, selectionEnd } = textarea
    const beforeCaret = value.slice(0, selectionStart)
    const match = selectionStart === selectionEnd ? /(?:^|\s)\/([^/\n]*)$/.exec(beforeCaret) : null
    if (!match) {
      setSlash(null)
      return
    }
    const query = match[1]
    const start = selectionStart - query.length - 1
    if (slash?.start === start && slash.end === selectionStart && slash.query === query) return
    setActiveNote(0)
    setSlash({ start, end: selectionStart, query })
  }

  function insertQuickReply(text: string) {
    if (!slash) return
    insertAtSelection(textareaRef.current, text, replyText, onReplyTextChange, slash)
    setSlash(null)
  }

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
    if (event.nativeEvent.isComposing) return
    if (showNotes) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlash(null)
        return
      }
      if (quickReplies.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        event.preventDefault()
        const offset = event.key === 'ArrowDown' ? 1 : -1
        const index = Math.min(activeNote, quickReplies.length - 1)
        setActiveNote((index + offset + quickReplies.length) % quickReplies.length)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (selectedNote) insertQuickReply(selectedNote.preview)
        return
      }
    }
    if (event.key !== 'Enter') return
    if (event.shiftKey) return
    event.preventDefault()
    if (sendingReply || !canReply || !hasOutgoing) return
    const form = event.currentTarget.form
    if (form) form.requestSubmit()
  }

  const blockedByBot = !canReply && replyBlockedReason === 'bot_mode'
  const blockedByWindow = !canReply && !blockedByBot
  const hasSecondary = canReply && (windowOpen ? flows.length > 0 : canSendTemplate)

  return (
    <>
      <form
        onSubmit={(e) => {
          if (!canReply || recording || !hasOutgoing) {
            e.preventDefault()
            return
          }
          setSlash(null)
          stopTyping()
          onSubmit(e)
        }}
        onKeyDown={(event) => {
          if (!recording || event.key !== 'Escape') return
          event.preventDefault()
          voice.cancel()
        }}
        className="inbox-compose-stack inbox-compose-stack--with-emoji"
      >
        <div role="status" className={typingNames.length ? 'px-1 text-xs text-muted' : 'sr-only'}>
          {typingNames.length > 0 &&
            `${typingNames.join(', ')} ${typingNames.length === 1 ? 'está escribiendo…' : 'están escribiendo…'}`}
        </div>
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
        {replyFile && canReply && (replyFile.voiceNote
          ? <InboxVoiceAttachment file={replyFile.file} onRemove={() => onReplyFileChange(null)} />
          : <InboxAttachment filename={replyFile.file.name} onRemove={() => onReplyFileChange(null)} />)}
        {voice.error && canReply && !hasOutgoing && (
          <p role="alert" className="px-1 text-xs text-bad">{voice.error}</p>
        )}

        {!canReply ? (
          <div className="flex flex-col gap-2 px-1 pb-1">
            <p className="text-xs text-muted">
              {blockedByBot
                ? 'Este chat está en modo Bot. Pásalo a Asesor para escribir libremente.'
                : windowOpen
                  ? 'No puedes escribir libremente ahora; inicia un flujo o envía una plantilla.'
                  : canSendTemplate
                    ? 'Ventana de 24 h cerrada; envía una plantilla para reabrir la conversación.'
                    : 'Ventana de 24 h cerrada; no tienes permiso para enviar plantillas.'}
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
              {blockedByWindow && canSendTemplate ? (
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

        <div
          className="inbox-compose-bar relative"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setSlash(null)
          }}
        >
          {canReply && recording ? (
            <div className="inbox-compose-grow flex flex-wrap items-center gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2 px-1 text-sm">
                {voice.status === 'recording' && (
                  <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-bad" />
                )}
                <span role="status">
                  {voice.status === 'requesting' ? 'Esperando acceso al micrófono…'
                    : voice.status === 'finishing' ? 'Preparando audio…' : 'Grabando'}
                </span>
                {voice.status === 'recording' && (
                  <span role="timer" aria-label="Tiempo de grabación" className="font-mono tabular-nums">
                    {Math.floor(voice.elapsedSeconds / 60)}:{String(voice.elapsedSeconds % 60).padStart(2, '0')}
                  </span>
                )}
              </div>
              <Button ref={cancelRecordingRef} type="button" variant="ghost" size="sm" onClick={voice.cancel}>
                Cancelar
              </Button>
              {voice.status === 'recording' && (
                <Button ref={stopRecordingRef} type="button" size="sm" onClick={voice.finish}>
                  Detener
                </Button>
              )}
            </div>
          ) : canReply ? (
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
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0]
                    if (file) onReplyFileChange({ file })
                    event.currentTarget.value = ''
                  }}
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
                onChange={(event) => {
                  onReplyTextChange(event.target.value)
                  updateQuickReplies(event.currentTarget)
                  signalTyping(event.target.value)
                }}
                onBlur={stopTyping}
                onSelect={(event) => {
                  if (showNotes) updateQuickReplies(event.currentTarget)
                }}
                onKeyDown={onTextareaKeyDown}
                rows={1}
                aria-label="Escribe un mensaje"
                aria-controls={showNotes ? notesListId : undefined}
                placeholder="Escribe un mensaje… / respuestas rápidas"
                className="inbox-compose-textarea inbox-compose-grow focus-visible:ring-1 focus-visible:ring-accent"
              />
              {showNotes && (
                <div
                  ref={quickRepliesRef}
                  id={notesListId}
                  role="region"
                  aria-label="Respuestas rápidas"
                  className="absolute inset-x-0 bottom-full z-20 mb-2 max-h-60 max-w-lg overflow-y-auto rounded-xl border border-line bg-surface-strong p-2"
                  onKeyDown={(event) => {
                    if (event.key !== 'Escape') return
                    event.preventDefault()
                    setSlash(null)
                    textareaRef.current?.focus()
                  }}
                >
                  <p role="status" className={selectedNote ? 'sr-only' : 'px-2 py-1 text-xs text-muted'}>
                    {selectedNote
                      ? `${selectedNote.title}. ${selectedNote.preview}`
                      : notesLoading ? 'Cargando respuestas…' : 'No hay respuestas que coincidan.'}
                  </p>
                  {quickReplies.length > 0 && (
                    <ul>
                      {quickReplies.map((note) => (
                        <li key={note.id}>
                          <button
                            type="button"
                            aria-current={note.id === selectedNote?.id ? 'true' : undefined}
                            className={cn(
                              'block w-full rounded-md px-2 py-1.5 text-left hover:bg-accent-soft focus-visible:ring-1 focus-visible:ring-accent',
                              note.id === selectedNote?.id && 'bg-accent-soft',
                            )}
                            onClick={() => insertQuickReply(note.preview)}
                          >
                            <span className="block truncate text-sm font-medium">{note.title}</span>
                            <span className="block truncate text-xs text-muted">{note.preview}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              <div className="inbox-compose-actions">
                <InboxAdvisorNotesPopover
                  triggerIcon={<IconPostIt />}
                  notes={notes}
                  loading={notesLoading}
                  loadNotes={loadNotes}
                  resolveText={resolveText}
                  onInsert={(text) => {
                    setSlash(null)
                    insertAtSelection(textareaRef.current, text, replyText, onReplyTextChange)
                  }}
                />

                <div className="inbox-compose-send-split">
                  <Button
                    ref={primaryActionRef}
                    type={showSend ? 'submit' : 'button'}
                    size="icon"
                    disabled={sendingReply}
                    aria-label={primaryLabel}
                    title={primaryLabel}
                    onClick={showSend ? undefined : () => {
                      setSlash(null)
                      stopTyping()
                      void voice.start()
                    }}
                    className={cn(
                      'inbox-compose-send inbox-compose-send--icon',
                      hasSecondary ? 'inbox-compose-send--split-main' : '',
                    )}
                  >
                    {sendingReply ? '…' : showSend ? <IconSend /> : <IconMicrophone />}
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

        {canReply && !recording ? (
          <p className="inbox-compose-hint-inline muted">
            ⏎ envía · ⇧⏎ nueva línea. WhatsApp: *negrita*, _cursiva_. JPEG/PNG (5 MB), MP4 (16 MB), audio (16 MB), PDF (25 MB).
          </p>
        ) : null}
      </form>
      {confirmDialog}
    </>
  )
}
