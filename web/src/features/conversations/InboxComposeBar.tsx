import { useRef, useState, type FormEvent } from 'react'
import { insertAtSelection, wrapSelection } from '@/shared/textSelection'
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

export type ReplyToMessage = {
  id: number
  preview: string
  outbound: boolean
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
}: InboxComposeBarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [fileAccept, setFileAccept] = useState<string>(ATTACH_OPTIONS[0].accept)
  const [emojiOpen, setEmojiOpen] = useState(false)

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

  return (
    <form onSubmit={onSubmit} className="inbox-compose-stack inbox-compose-stack--with-emoji">
      {replyTo ? (
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
      {replyFile ? (
        <InboxAttachment filename={replyFile.name} onRemove={() => onReplyFileChange(null)} />
      ) : null}

      <div className="inbox-compose-bar">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" title="Adjuntar archivo">
              <span aria-hidden="true">📎</span>
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
              <span aria-hidden="true">😊</span>
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
        <Button type="submit" disabled={sendingReply} className="inbox-compose-send">
          {sendingReply ? '…' : 'Enviar'}
        </Button>
      </div>

      <p className="inbox-compose-hint-inline muted">
        WhatsApp: *negrita*, _cursiva_. JPEG/PNG (5 MB), MP4 (16 MB), audio (16 MB), PDF (25 MB).
      </p>
    </form>
  )
}
