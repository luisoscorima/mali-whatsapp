import { buildMonthFilterOptions } from './monthFilterUtils'

type MonthFilterChipsProps = {
  selectedMonthKey: string
  onChange: (monthKey: string) => void
  className?: string
}

export function MonthFilterChips({
  selectedMonthKey,
  onChange,
  className = '',
}: MonthFilterChipsProps) {
  const options = buildMonthFilterOptions()
  return (
    <div
      className={`inbox-chat-filter-pills inbox-chat-filter-pills--row contact-filter-pills flex flex-wrap gap-1 ${className}`.trim()}
    >
      {options.map((opt) => (
        <button
          key={opt.key || 'all'}
          type="button"
          className={`inbox-chat-pill contact-filter-pill text-[11px] ${
            selectedMonthKey === opt.key ? 'is-active' : ''
          }`}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}
