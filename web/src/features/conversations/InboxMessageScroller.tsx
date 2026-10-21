import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
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
  preserveScrollOnPrepend: () => void
}

type InboxMessageScrollerProps = {
  conversationId: number
  scrollToMessageId?: number | null
  children: ReactNode
  className?: string
  onLoadOlder?: () => void
  onLoadNewer?: () => void
  onJumpToLatest?: () => void
}

function nearBottom(element: HTMLElement, threshold = 120): boolean {
  return (
    element.scrollHeight - element.scrollTop - element.clientHeight < threshold
  )
}

export const InboxMessageScroller = forwardRef<
  InboxMessageScrollerHandle,
  InboxMessageScrollerProps
>(function InboxMessageScroller(
  {
    conversationId,
    scrollToMessageId,
    children,
    className,
    onLoadOlder,
    onLoadNewer,
    onJumpToLatest,
  },
  ref,
) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [showJump, setShowJump] = useState(false)
  const anchorRef = useRef<{ height: number; top: number } | null>(null)
  const previousTopRef = useRef(0)
  const userScrollRef = useRef(false)

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const el = viewportRef.current
    if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior })
    setShowJump(false)
  }, [])

  const scrollToMessage = useCallback(
    (messageId: number, behavior: ScrollBehavior = 'smooth') => {
      const el = viewportRef.current?.querySelector(`#chat-msg-${messageId}`)
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ behavior, block: 'center' })
        setShowJump(!nearBottom(viewportRef.current!))
      }
    },
    [],
  )

  useImperativeHandle(
    ref,
    () => ({
      scrollToBottom,
      scrollToMessage,
      isNearBottom: () => {
        const el = viewportRef.current
        return el ? nearBottom(el) : true
      },
      preserveScrollOnPrepend: () => {
        const el = viewportRef.current
        if (!el) return
        anchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
      },
    }),
    [scrollToBottom, scrollToMessage],
  )

  useLayoutEffect(() => {
    const el = viewportRef.current
    const anchor = anchorRef.current
    if (!el || !anchor) return
    anchorRef.current = null
    userScrollRef.current = false
    el.scrollTop = anchor.top + el.scrollHeight - anchor.height
    previousTopRef.current = el.scrollTop
  }, [children])

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      userScrollRef.current = false
      if (
        scrollToMessageId &&
        viewportRef.current?.querySelector(`#chat-msg-${scrollToMessageId}`)
      ) {
        scrollToMessage(scrollToMessageId, 'auto')
        return
      }
      scrollToBottom('auto')
    })
    return () => cancelAnimationFrame(frame)
  }, [conversationId, scrollToMessageId, scrollToBottom, scrollToMessage])

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return

    function onScroll() {
      setShowJump(!nearBottom(el!))
      const top = el!.scrollTop
      const previousTop = previousTopRef.current
      previousTopRef.current = top
      // Solo al desplazarse hacia el borde: no recorrer páginas al montar.
      if (!userScrollRef.current) return
      if (top < previousTop && top < 160) {
        userScrollRef.current = false
        onLoadOlder?.()
      }
      if (top > previousTop && nearBottom(el!, 160)) {
        userScrollRef.current = false
        onLoadNewer?.()
      }
    }

    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [conversationId, onLoadOlder, onLoadNewer])

  return (
    <div className={cn('relative min-h-0 flex-1', className)}>
      <div
        ref={viewportRef}
        className="chat-thread--inbox h-full overflow-y-auto"
        style={{ overflowAnchor: 'none' }}
        onWheel={() => {
          userScrollRef.current = true
        }}
        onTouchMove={() => {
          userScrollRef.current = true
        }}
        onPointerDown={() => {
          userScrollRef.current = true
        }}
        onKeyDown={(event) => {
          if (
            [
              'ArrowUp',
              'ArrowDown',
              'PageUp',
              'PageDown',
              'Home',
              'End',
              ' ',
            ].includes(event.key)
          )
            userScrollRef.current = true
        }}
        tabIndex={0}
      >
        {children}
      </div>
      {showJump || onJumpToLatest ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="absolute bottom-14 right-3 z-10 rounded-full shadow-md"
          onClick={() =>
            onJumpToLatest ? onJumpToLatest() : scrollToBottom('smooth')
          }
        >
          Ir al final ↓
        </Button>
      ) : null}
    </div>
  )
})
