import {
  SEGMENT_COLOR_KEYS,
  SEGMENT_COLOR_LABELS,
  SEGMENT_SWATCH_BG,
  normalizeSegmentColorKey,
  type SegmentColorKey,
} from './segmentColors'

type SegmentColorPickerProps = {
  value: string
  onChange: (key: SegmentColorKey) => void
  label?: string
  className?: string
}

export function SegmentColorPicker({
  value,
  onChange,
  label = 'Color',
  className = '',
}: SegmentColorPickerProps) {
  const selected = normalizeSegmentColorKey(value)

  return (
    <fieldset className={`block text-sm ${className}`.trim()}>
      <legend className="text-muted">{label}</legend>
      <div className="mt-2 flex flex-wrap gap-2.5" role="radiogroup" aria-label={label}>
        {SEGMENT_COLOR_KEYS.map((key) => {
          const isSelected = selected === key
          return (
            <label
              key={key}
              title={SEGMENT_COLOR_LABELS[key]}
              className="cursor-pointer"
            >
              <input
                type="radio"
                name="segment_color"
                value={key}
                checked={isSelected}
                onChange={() => onChange(key)}
                className="sr-only"
              />
              <span
                className={`block h-7 w-7 rounded-full border border-line transition-transform hover:scale-110 ${
                  isSelected
                    ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-strong'
                    : ''
                }`}
                style={{ backgroundColor: SEGMENT_SWATCH_BG[key] }}
                aria-hidden="true"
              />
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
