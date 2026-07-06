import { useState, type MouseEvent, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/shared/ui/shadcn/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const

type ChatMessageBubbleMenuProps = {
  outbound: boolean
  canInteract: boolean
  hasCopyText: boolean
  onReply: () => void
  onCopy: () => void
  onReact: (emoji: string) => void
  children: ReactNode
}

export function ChatMessageBubbleMenu({
  outbound,
  canInteract,
  hasCopyText,
  onReply,
  onCopy,
  onReact,
  children,
}: ChatMessageBubbleMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [reactOpen, setReactOpen] = useState(false)

  if (!canInteract) {
    return <>{children}</>
  }

  function openFromContext(event: MouseEvent) {
    event.preventDefault()
    setMenuOpen(true)
  }

  return (
    <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <div
        className={cn(
          'chat-bubble-wrap',
          outbound ? 'chat-bubble-wrap--out' : 'chat-bubble-wrap--in',
        )}
        onContextMenu={openFromContext}
      >
        {children}
        <div className="chat-bubble__actions">
          <DropdownMenuTrigger
            className="chat-bubble__actions-btn inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm hover:bg-accent-soft"
            aria-label="Opciones del mensaje"
            title="Opciones"
          >
            ⋮
          </DropdownMenuTrigger>
        </div>
      </div>
      <DropdownMenuContent align={menuOpen ? 'end' : 'center'} className="w-44">
        <DropdownMenuItem
          onSelect={() => {
            onReply()
            setMenuOpen(false)
          }}
        >
          Responder
        </DropdownMenuItem>
        {hasCopyText ? (
          <DropdownMenuItem
            onSelect={() => {
              onCopy()
              setMenuOpen(false)
            }}
          >
            Copiar texto
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <p className="mb-1 text-xs text-muted">Reaccionar</p>
          <div className="flex flex-wrap gap-1">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="rounded-md px-1.5 py-0.5 text-lg hover:bg-accent-soft"
                onClick={() => {
                  onReact(emoji)
                  setMenuOpen(false)
                }}
                aria-label={`Reaccionar con ${emoji}`}
              >
                {emoji}
              </button>
            ))}
            <Popover open={reactOpen} onOpenChange={setReactOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="rounded-md px-1.5 py-0.5 text-sm text-muted hover:bg-accent-soft"
                >
                  Más…
                </button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-auto p-2">
                <div className="grid grid-cols-6 gap-1">
                  {['😀', '😊', '😍', '🔥', '✅', '⭐', '👏', '🎉', '💯', '🤔', '😅', '🙌'].map(
                    (emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="rounded-md px-1 py-0.5 text-lg hover:bg-accent-soft"
                        onClick={() => {
                          onReact(emoji)
                          setReactOpen(false)
                          setMenuOpen(false)
                        }}
                      >
                        {emoji}
                      </button>
                    ),
                  )}
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
