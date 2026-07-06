import { PALETTE_OPTIONS } from '@/shared/theme/palettes'
import { usePalette } from '@/shared/theme/usePalette'

export function PalettePicker() {
  const { palette, setPalette } = usePalette()

  return (
    <div className="border-b border-line px-4 py-3">
      <p className="text-xs font-medium text-muted">Color de acento</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {PALETTE_OPTIONS.map((option) => {
          const active = palette === option.id
          return (
            <button
              key={option.id}
              type="button"
              title={option.label}
              aria-label={option.label}
              aria-pressed={active}
              onClick={() => setPalette(option.id)}
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition ${
                active ? 'border-accent ring-2 ring-accent/30' : 'border-line hover:border-accent/50'
              }`}
            >
              <span
                className="h-5 w-5 rounded-full"
                style={{ backgroundColor: option.swatch }}
                aria-hidden="true"
              />
            </button>
          )
        })}
      </div>
    </div>
  )
}
