import type { CategoryOption } from './useCategoryScope'

type Props = {
  options: CategoryOption[]
  value: string
  onChange: (value: string) => void
  showMissing?: boolean
}

/** Solo se muestra con más de una categoría permitida. */
export function CategoryCreateSelect({
  options,
  value,
  onChange,
  showMissing = false,
}: Props) {
  if (options.length <= 1) return null
  return (
    <label className="block text-sm">
      <span className="text-muted">Categoría</span>
      <select
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
      >
        <option value="">Elegir…</option>
        {options.map((item) => (
          <option key={item.slug} value={item.slug}>
            {item.label}
          </option>
        ))}
      </select>
      {showMissing ? (
        <span className="mt-1 block text-sm text-danger">Elige una categoría</span>
      ) : null}
    </label>
  )
}
