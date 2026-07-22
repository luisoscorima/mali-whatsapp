export type AttributeFieldDefinition = {
  id: number
  segment_slug: string | null
  slug: string
  label: string
  field_type: string
  options?: string[] | null
  sort_order: number
  required: boolean
}

export function getApplicableAttributeDefinitions(
  all: AttributeFieldDefinition[],
  segmentSlugs: string[],
): AttributeFieldDefinition[] {
  const segSet = new Set(segmentSlugs)
  const bySlug = new Map<string, AttributeFieldDefinition>()

  for (const row of all) {
    if (!row.segment_slug) bySlug.set(row.slug, row)
  }
  for (const row of all) {
    if (row.segment_slug && segSet.has(row.segment_slug)) {
      bySlug.set(row.slug, row)
    }
  }

  return [...bySlug.values()].sort((a, b) => {
    const ao = Number(a.sort_order) || 0
    const bo = Number(b.sort_order) || 0
    if (ao !== bo) return ao - bo
    return a.label.localeCompare(b.label)
  })
}

export function inputTypeForField(fieldType: string): string {
  if (fieldType === 'date') return 'date'
  if (fieldType === 'number') return 'number'
  return 'text'
}
