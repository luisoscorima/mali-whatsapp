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
  /** filter = lista/inbox; form = crear/editar contacto */
  variant?: 'filter' | 'form'
  /** Trigger más estrecho para compartir fila con el buscador */
  compact?: boolean
  disabled?: boolean
  className?: string
}

function triggerLabel(
  segments: SegmentFilterOption[],
  selectedSlugs: string[],
  variant: 'filter' | 'form',
  compact: boolean,
): string {
  if (selectedSlugs.length === 0) {
    if (variant === 'form') return 'Elegir segmentos…'
    return compact ? 'Segmentos' : 'Segmentos: Todos'
  }
  const noneActive = selectedSlugs.includes(SEGMENT_NONE)
  const active = segments.filter((s) => selectedSlugs.includes(s.slug))
  const parts = [
    ...active.map((s) => s.label),
    ...(noneActive ? ['Sin segmento'] : []),
  ]
  const prefix = variant === 'form' || compact ? '' : 'Segmentos: '
  if (parts.length <= 2) return `${prefix}${parts.join(', ')}`
  return `${prefix}${parts.length} seleccionados`
}

export function SegmentFilterSelect({
  segments,
  selectedSlugs,
  onToggle,
  onClearAll,
  showNoneOption = true,
  variant = 'filter',
  compact = false,
  disabled = false,
  className = '',
}: SegmentFilterSelectProps) {
  const { theme } = useTheme()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const hasSelection = selectedSlugs.length > 0
  const noneActive = selectedSlugs.includes(SEGMENT_NONE)
  const clearLabel = variant === 'form' ? 'Ninguno' : 'Todos'
  const effectiveShowNone = variant === 'form' ? false : showNoneOption

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return segments
    return segments.filter(
      (s) =>
        s.label.toLowerCase().includes(q) || s.slug.toLowerCase().includes(q),
    )
  }, [segments, query])

  const showNoneInList =
    effectiveShowNone &&
    (!query.trim() ||
      'sin segmento'.includes(query.trim().toLowerCase()) ||
      'none'.includes(query.trim().toLowerCase()))

  return (
    <div className={className.trim() || undefined}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled) return
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={`flex items-center justify-between gap-2 rounded-lg border border-line bg-bg px-2.5 py-2 text-left text-sm disabled:opacity-60 ${
              compact ? 'w-auto max-w-[7.5rem] shrink-0' : 'w-full'
            } ${hasSelection ? 'border-accent/40' : ''}`}
            aria-label={
              variant === 'form' ? 'Seleccionar segmentos' : 'Filtrar por segmento'
            }
            title={
              variant === 'filter' && hasSelection
                ? 'Unión: resultados en cualquiera de los segmentos seleccionados'
                : triggerLabel(segments, selectedSlugs, variant, compact)
            }
          >
            <span className="min-w-0 truncate">
              {triggerLabel(segments, selectedSlugs, variant, compact)}
            </span>
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
                !hasSelection
                  ? 'bg-accent-soft font-semibold text-accent'
                  : 'hover:bg-surface'
              }`}
              onClick={() => {
                onClearAll()
                if (variant === 'filter') setOpen(false)
              }}
            >
              {clearLabel}
            </button>
          </div>
          <ul className="max-h-56 overflow-y-auto text-sm" aria-label="Segmentos">
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
                      style={segmentFilterPillStyle(
                        seg.color_key ?? 'slate',
                        theme,
                        checked,
                      )}
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
