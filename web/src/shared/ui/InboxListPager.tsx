import {
  useEffect,
  useRef,
  type DependencyList,
  type ReactNode,
  type RefObject,
} from 'react'
import { useState } from 'react'
import { Button } from '@/shared/ui/shadcn/button'

/** Páginas visibles del paginador: 1, 2, 3, …, N (con vecinos del actual). */
export function listPageItems(
  current: number,
  total: number,
): Array<number | 'ellipsis'> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1)
  }
  const show = new Set<number>([1, total])
  for (let p = current - 1; p <= current + 1; p++) {
    if (p >= 1 && p <= total) show.add(p)
  }
  if (current <= 3) {
    show.add(2)
    show.add(3)
    show.add(4)
  }
  if (current >= total - 2) {
    show.add(total - 1)
    show.add(total - 2)
    show.add(total - 3)
  }
  const sorted = [...show].sort((a, b) => a - b)
  const out: Array<number | 'ellipsis'> = []
  let prev = 0
  for (const p of sorted) {
    if (prev > 0 && p - prev > 1) out.push('ellipsis')
    out.push(p)
    prev = p
  }
  return out
}

export function InboxListPager({
  page,
  totalPages,
  onPageChange,
  ariaLabel = 'Paginación',
}: {
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  ariaLabel?: string
}) {
  if (totalPages <= 1) return null
  return (
    <div
      className="inbox-chat-list-pager inbox-chat-list-pager--sticky"
      role="navigation"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="small-btn"
        aria-label="Página anterior"
      >
        {'<'}
      </button>
      {listPageItems(page, totalPages).map((item, idx) =>
        item === 'ellipsis' ? (
          <span key={`e-${idx}`} className="inbox-chat-list-pager-ellipsis muted">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            className={`small-btn${item === page ? ' primary' : ''}`}
            aria-current={item === page ? 'page' : undefined}
            onClick={() => {
              if (item !== page) onPageChange(item)
            }}
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="small-btn"
        aria-label="Página siguiente"
      >
        {'>'}
      </button>
    </div>
  )
}

export function useElementScrollEdge(
  ref: RefObject<HTMLElement | null>,
  deps: DependencyList = [],
) {
  const [scrollAtEnd, setScrollAtEnd] = useState(false)
  const [canScroll, setCanScroll] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    function sync() {
      const node = ref.current
      if (!node) return
      const can = node.scrollHeight > node.clientHeight + 8
      setCanScroll(can)
      setScrollAtEnd(
        can && node.scrollHeight - node.scrollTop - node.clientHeight < 48,
      )
    }

    sync()
    el.addEventListener('scroll', sync, { passive: true })
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null
    ro?.observe(el)
    const content = el.firstElementChild
    if (content && ro) ro.observe(content)

    return () => {
      el.removeEventListener('scroll', sync)
      ro?.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes explicit deps
  }, deps)

  function scrollToEdge() {
    const el = ref.current
    if (!el) return
    el.scrollTo({
      top: scrollAtEnd ? 0 : el.scrollHeight,
      behavior: 'smooth',
    })
  }

  return { scrollAtEnd, canScroll, scrollToEdge }
}

/** Tabla con scroll vertical + botón ↑/↓ + paginador estilo inbox. */
export function ReportScrollableTable({
  children,
  page,
  totalPages,
  onPageChange,
  ariaLabel = 'Paginación',
  syncKey,
}: {
  children: ReactNode
  page: number
  totalPages: number
  onPageChange: (page: number) => void
  ariaLabel?: string
  /** Cambia cuando el contenido listado cambia (p. ej. total o tab). */
  syncKey?: string | number
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { scrollAtEnd, canScroll, scrollToEdge } = useElementScrollEdge(
    scrollRef,
    [page, totalPages, syncKey],
  )
  const showPager = totalPages > 1

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="max-h-[min(60vh,36rem)] overflow-auto rounded-lg border border-line"
      >
        {children}
      </div>
      {canScroll ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={`inbox-chat-list-scroll-btn absolute z-10 size-8 rounded-full p-0 shadow-md${
            showPager ? ' inbox-chat-list-scroll-btn--above-pager' : ''
          }`}
          onClick={scrollToEdge}
          aria-label={
            scrollAtEnd ? 'Ir al inicio de la lista' : 'Ir al final de la lista'
          }
          title={scrollAtEnd ? 'Ir al inicio' : 'Ir al final'}
        >
          {scrollAtEnd ? '↑' : '↓'}
        </Button>
      ) : null}
      <InboxListPager
        page={page}
        totalPages={totalPages}
        onPageChange={onPageChange}
        ariaLabel={ariaLabel}
      />
    </div>
  )
}
