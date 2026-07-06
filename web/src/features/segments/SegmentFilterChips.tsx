export const SEGMENT_NONE = '__none__'

export type SegmentFilterOption = {
  slug: string
  label: string
  color_key: string
}

type SegmentFilterChipsProps = {
  segments: SegmentFilterOption[]
  selectedSlugs: string[]
  onToggle: (slug: string) => void
  onClearAll: () => void
  showNoneChip?: boolean
  className?: string
}

function segmentToneKey(colorKey: string | null | undefined): string {
  const key = colorKey ?? 'slate'
  return ['teal', 'emerald', 'blue', 'violet', 'amber', 'rose', 'slate'].includes(key)
    ? key
    : 'slate'
}

export function SegmentFilterChips({
  segments,
  selectedSlugs,
  onToggle,
  onClearAll,
  showNoneChip = true,
  className = '',
}: SegmentFilterChipsProps) {
  const hasFilter = selectedSlugs.length > 0
  const activeSlugs = selectedSlugs.filter((s) => s !== SEGMENT_NONE)
  const noneActive = selectedSlugs.includes(SEGMENT_NONE)
  const activeSegs = segments.filter((s) => activeSlugs.includes(s.slug))
  const inactiveSegs = segments.filter((s) => !activeSlugs.includes(s.slug))

  return (
    <div
      className={`inbox-chat-filter-pills inbox-chat-filter-pills--row contact-filter-pills segment-filter-chips ${className}`.trim()}
      aria-label="Filtrar por segmento"
      title={hasFilter ? 'Unión: resultados en cualquiera de los segmentos seleccionados' : undefined}
    >
      <button
        type="button"
        onClick={onClearAll}
        className={`inbox-chat-pill contact-filter-pill ${!hasFilter ? 'is-active' : ''}`}
        aria-current={!hasFilter ? 'true' : undefined}
      >
        Todos
      </button>
      {activeSegs.map((seg) => (
        <button
          key={seg.slug}
          type="button"
          onClick={() => onToggle(seg.slug)}
          className="inbox-chat-pill contact-filter-pill is-active"
          data-seg-tone={segmentToneKey(seg.color_key)}
          aria-current="true"
          title={`Quitar ${seg.label}`}
        >
          {seg.label}
        </button>
      ))}
      {showNoneChip && noneActive ? (
        <button
          type="button"
          onClick={() => onToggle(SEGMENT_NONE)}
          className="inbox-chat-pill contact-filter-pill is-active"
          data-seg-tone="slate"
          aria-current="true"
          title="Quitar filtro sin segmento"
        >
          Sin segmento
        </button>
      ) : null}
      {showNoneChip && !noneActive ? (
        <button
          type="button"
          onClick={() => onToggle(SEGMENT_NONE)}
          className="inbox-chat-pill contact-filter-pill"
          data-seg-tone="slate"
          title="Añadir filtro sin segmento"
        >
          Sin segmento
        </button>
      ) : null}
      {inactiveSegs.map((seg) => (
        <button
          key={seg.slug}
          type="button"
          onClick={() => onToggle(seg.slug)}
          className="inbox-chat-pill contact-filter-pill"
          data-seg-tone={segmentToneKey(seg.color_key)}
          title={`Añadir ${seg.label}`}
        >
          {seg.label}
        </button>
      ))}
    </div>
  )
}
