/** Opciones de segmento para formularios de contacto / audiencia. */
export type SegmentSelectOption = {
  id: number
  slug: string
  label: string
  color_key?: string
  active?: boolean
}

/** Solo segmentos activos (elegibles para asignar). */
export function segmentOptionsForAssignment(
  segments: SegmentSelectOption[],
): SegmentSelectOption[] {
  return segments
    .filter((s) => s.active !== false)
    .map((s) => ({
      id: s.id,
      slug: s.slug,
      label: s.label,
      color_key: s.color_key,
    }))
}

/** Quita del contacto slugs que ya no son asignables (inactivos). */
export function pruneSegmentSlugsToOptions(
  selectedSlugs: string[],
  options: SegmentSelectOption[],
): string[] {
  const allowed = new Set(options.map((s) => s.slug))
  return selectedSlugs.filter((slug) => allowed.has(slug))
}
