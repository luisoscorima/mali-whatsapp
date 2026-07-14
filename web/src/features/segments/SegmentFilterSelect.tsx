import { useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'
import { useTheme } from '@/shared/theme/useTheme'
import { segmentFilterPillStyle } from './segmentColors'
import {
  SEGMENT_NONE,
  type SegmentFilterOption,
} from './SegmentFilterChips'

export type { SegmentFilterOption }

type SegmentFilterSelectProps = {
  segments: SegmentFilterOption[]
  selectedSlugs: string[]
  onToggle: (slug: string) => void
  onClearAll: () => void
  showNoneOption?: boolean
  className?: string
}

function triggerLabel(
  segments: SegmentFilterOption[],
  selectedSlugs: string[],
): string {
  if (selectedSlugs.length === 0) return 'Segmentos: Todos'
  const noneActive = selectedSlugs.includes(SEGMENT_NONE)
  const active = segments.filter((s) => selectedSlugs.includes(s.slug))
  const parts = [
    ...active.map((s) => s.label),
    ...(noneActive ? ['Sin segmento'] : []),
  ]
  if (parts.length <= 2) return `Segmentos: ${parts.join(', ')}`
  return `Segmentos: ${parts.length} seleccionados`
}

export function SegmentFilterSelect({
  segments,
  selectedSlugs,
  onToggle,
  onClearAll,
  showNoneOption = true,
  className = '',
}: SegmentFilterSelectProps) {
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const hasFilter = selectedSlugs.length > 0
  const noneActive = selectedSlugs.includes(SEGMENT_NONE)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return segments
    return segments.filter(
      (s) =>
        s.label.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
    )
  }, [segments, query])

  const showNoneInList =
    showNoneOption &&
    (!query.trim() ||
      'sin segmento'.includes(query.trim().toLowerCase()) ||
      'none'.includes(query.trim().toLowerCase()))

  return (
    <div className={className.trim() || undefined}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-bg px-2.5 py-1.5 text-left text-xs ${
              hasFilter ? 'border-accent/40' : ''
            }`}
            aria-label="Filtrar por segmento"
            title={
              hasFilter
                ? 'Unión: resultados en cualquiera de los segmentos seleccionados'
                : undefined
            }
          >
            <span className="min-w-0 truncate">{triggerLabel(segments, selectedSlugs)}</span>
            <span className="shrink-0 text-muted" aria-hidden>
              ▾
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar segmento…"
            className="mb-2 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
            autoFocus
          />
          <div className="mb-1 flex gap-1">
            <button
              type="button"
              className={`rounded-md px-2 py-1 text-xs ${
                !hasFilter ? 'bg-accent-soft font-semibold text-accent' : 'hover:bg-surface'
              }`}
              onClick={() => {
                onClearAll()
                setOpen(false)
              }}
            >
              Todos
            </button>
          </div>
          <ul
            className="max-h-56 overflow-y-auto text-sm"
            aria-label="Segmentos"
          >
            {showNoneInList ? (
              <li>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface">
                  <input
                    type="checkbox"
                    checked={noneActive}
                    onChange={() => onToggle(SEGMENT_NONE)}
                  />
                  <span
                    className="rounded px-1.5 py-0.5 text-xs"
                    style={segmentFilterPillStyle('slate', theme, noneActive)}
                  >
                    Sin segmento
                  </span>
                </label>
              </li>
            ) : null}
            {filtered.map((seg) => {
              const checked = selectedSlugs.includes(seg.slug)
              return (
                <li key={seg.slug}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggle(seg.slug)}
                    />
                    <span
                      className="rounded px-1.5 py-0.5 text-xs"
                      style={segmentFilterPillStyle(seg.color_key, theme, checked)}
                    >
                      {seg.label}
                    </span>
                  </label>
                </li>
              )
            })}
            {filtered.length === 0 && !showNoneInList ? (
              <li className="px-2 py-2 text-xs text-muted">Sin coincidencias</li>
            ) : null}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}
