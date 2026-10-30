import { useMemo, useState } from 'react'
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/shadcn/popover'

export type SearchableSelectOption = {
  value: string
  label: string
  group?: string
  /** Extra text matched by search (e.g. language, slug) */
  keywords?: string
}

type SearchableSelectProps = {
  options: SearchableSelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyLabel?: string
  disabled?: boolean
  className?: string
  /** Optional empty-value row at the top (clears selection) */
  clearOption?: { value?: string; label: string }
  'aria-label'?: string
}

const GROUP_ORDER = ['General', 'Cursos de Arte', 'Extensión Profesional', 'MARKETING', 'UTILITY', 'AUTHENTICATION', 'SERVICE']

function groupRank(group?: string): number {
  if (!group) return GROUP_ORDER.length + 1
  const idx = GROUP_ORDER.indexOf(group)
  return idx >= 0 ? idx : GROUP_ORDER.length
}

function matchesQuery(opt: SearchableSelectOption, q: string): boolean {
  return (
    opt.label.toLowerCase().includes(q) ||
    opt.value.toLowerCase().includes(q) ||
    Boolean(opt.group?.toLowerCase().includes(q)) ||
    Boolean(opt.keywords?.toLowerCase().includes(q))
  )
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Elegir…',
  searchPlaceholder = 'Buscar…',
  emptyLabel = 'Sin coincidencias',
  disabled = false,
  className = '',
  clearOption,
  'aria-label': ariaLabel,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const clearValue = clearOption?.value ?? ''

  const selected = options.find((o) => o.value === value)
  const triggerText = selected
    ? selected.group
      ? `${selected.group} · ${selected.label}`
      : selected.label
    : value === clearValue && clearOption
      ? clearOption.label
      : placeholder

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o) => matchesQuery(o, q))
  }, [options, query])

  const ordered = useMemo(() => {
    return [...filtered].sort(
      (a, b) =>
        groupRank(a.group) - groupRank(b.group) ||
        (a.group ?? '').localeCompare(b.group ?? '') ||
        a.label.localeCompare(b.label),
    )
  }, [filtered])

  const showClear =
    Boolean(clearOption) &&
    (!query.trim() || clearOption!.label.toLowerCase().includes(query.trim().toLowerCase()))

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
            aria-label={ariaLabel}
            title={triggerText}
            className={`flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-bg px-2.5 py-2 text-left text-sm disabled:opacity-60 ${
              value && value !== clearValue ? 'border-accent/40' : ''
            }`}
          >
            <span className={`min-w-0 truncate ${!selected && value !== clearValue ? 'text-muted' : ''}`}>
              {triggerText}
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
            placeholder={searchPlaceholder}
            className="mb-2 w-full rounded-lg border border-line bg-bg px-2 py-1.5 text-sm"
            autoFocus
          />
          <ul className="max-h-56 overflow-y-auto text-sm" role="listbox">
            {showClear ? (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={value === clearValue}
                  className={`flex w-full rounded-md px-2 py-1.5 text-left hover:bg-surface ${
                    value === clearValue ? 'bg-accent-soft font-semibold text-accent' : ''
                  }`}
                  onClick={() => {
                    onChange(clearValue)
                    setOpen(false)
                    setQuery('')
                  }}
                >
                  {clearOption!.label}
                </button>
              </li>
            ) : null}
            {ordered.map((opt, index) => {
              const selectedOpt = opt.value === value
              const showGroup =
                Boolean(opt.group) &&
                (index === 0 || ordered[index - 1].group !== opt.group)
              return (
                <li key={`${opt.group ?? ''}:${opt.value}:${index}`}>
                  {showGroup ? (
                    <div className="mt-3 mb-1 border-t border-line px-2 pt-2 text-xs font-bold text-muted">
                      {opt.group}
                    </div>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedOpt}
                    className={`flex w-full rounded-md px-2 py-1.5 text-left hover:bg-surface ${
                      selectedOpt ? 'bg-accent-soft font-semibold text-accent' : ''
                    }`}
                    onClick={() => {
                      onChange(opt.value)
                      setOpen(false)
                      setQuery('')
                    }}
                  >
                    <span className="min-w-0 truncate">{opt.label}</span>
                  </button>
                </li>
              )
            })}
            {ordered.length === 0 && !showClear ? (
              <li className="px-2 py-2 text-xs text-muted">{emptyLabel}</li>
            ) : null}
          </ul>
        </PopoverContent>
      </Popover>
    </div>
  )
}
