import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { Button } from '@/shared/ui/shadcn/button'
import { cn } from '@/lib/utils'

export type InboxMessageScrollerHandle = {
  scrollToBottom: (behavior?: ScrollBehavior) => void
  scrollToMessage: (messageId: number, behavior?: ScrollBehavior) => void
  isNearBottom: () => boolean
}

type InboxMessageScrollerProps = {
  conversationId: number
  scrollToMessageId?: number | null
  children: ReactNode
  className?: string
}

function nearBottom(element: HTMLElement, threshold = 120): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight < threshold
}

export const InboxMessageScroller = forwardRef<
  InboxMessageScrollerHandle,
  InboxMessageScrollerProps
>(function InboxMessageScroller(
  { conversationId, scrollToMessageId, children, className },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [showJump, setShowJump] = useState(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    setShowJump(false)
  }, [])

  const scrollToMessage = useCallback((messageId: number, behavior: ScrollBehavior = 'smooth') => {
    const el = viewportRef.current?.querySelector(`#chat-msg-${messageId}`)
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior, block: 'center' })
      setShowJump(!nearBottom(viewportRef.current!))
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom,
      scrollToMessage,
      isNearBottom: () => {
        const el = viewportRef.current
        return el ? nearBottom(el) : true
      },
    }),
    [scrollToBottom, scrollToMessage],
  )

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollToMessageId) {
        scrollToMessage(scrollToMessageId, 'auto')
        return
      }
      scrollToBottom('auto')
    })
  }, [conversationId, scrollToMessageId, scrollToBottom, scrollToMessage])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    function onScroll() {
      setShowJump(!nearBottom(el!))
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [conversationId])

  return (
    <div className={cn('relative min-h-0 flex-1', className)}>
      <div
        ref={viewportRef}
        className="chat-thread--inbox h-full overflow-y-auto"
      >
        {children}
      </div>
      {showJump ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="absolute bottom-3 left-1/2 z-10 -translate-x-1/2 rounded-full shadow-md"
          onClick={() => scrollToBottom('smooth')}
        >
          Ir al final ↓
        </Button>
      ) : null}
    </div>
  )
})
