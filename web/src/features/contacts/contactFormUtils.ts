export type AttributeFieldDefinition = {
  id: number
  segment_slug: string | null
  slug: string
  label: string
  field_type: string
  options?: string[] | null
  sort_order: number
  required: boolean
  category?: string
}

export function getApplicableAttributeDefinitions(
  all: AttributeFieldDefinition[],
  segmentSlugs: string[],
): AttributeFieldDefinition[] {
  const segSet = new Set(segmentSlugs)
  const bySlug = new Map<string, AttributeFieldDefinition>()
  const keyOf = (row: AttributeFieldDefinition) =>
    `${row.category || 'general'}:${row.slug}`

  for (const row of all) {
    if (!row.segment_slug) bySlug.set(keyOf(row), row)
  }
  for (const row of all) {
    if (row.segment_slug && segSet.has(row.segment_slug)) {
      bySlug.set(keyOf(row), row)
    }
  }

  return [...bySlug.values()].sort((a, b) => {
    const ao = Number(a.sort_order) || 0
    const bo = Number(b.sort_order) || 0
    if (ao !== bo) return ao - bo
    return a.label.localeCompare(b.label)
  })
}

const CATEGORY_ORDER = ['general', 'ca', 'ep']

export function groupByCategory<T extends { category?: string }>(items: T[]) {
  const groups = new Map<string, T[]>()
  for (const item of items) {
    const key = item.category || 'general'
    const list = groups.get(key) ?? []
    list.push(item)
    groups.set(key, list)
  }
  return [...groups.entries()]
    .sort((left, right) => {
      const leftOrder = CATEGORY_ORDER.indexOf(left[0])
      const rightOrder = CATEGORY_ORDER.indexOf(right[0])
      return (
        (leftOrder === -1 ? 99 : leftOrder) - (rightOrder === -1 ? 99 : rightOrder) ||
        left[0].localeCompare(right[0])
      )
    })
    .map(([key, grouped]) => ({
      key,
      label: key === 'general' ? 'General' : key.toUpperCase(),
      items: grouped,
    }))
}

export function inputTypeForField(fieldType: string): string {
  if (fieldType === 'date') return 'date'
  if (fieldType === 'number') return 'number'
  return 'text'
}
