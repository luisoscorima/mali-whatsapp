import { useEffect, useMemo, useState } from 'react'
import { useTheme } from '@/shared/theme/useTheme'
import { segmentFilterPillStyle } from '../segments/segmentColors'

export type AssignableSegmentOption = {
  slug: string
  label: string
  color_key?: string
  assignment_group?: string | null
  category?: string
}

export function groupAssignableSegments(
  segments: AssignableSegmentOption[],
  category: string | null | undefined,
): Array<[string, AssignableSegmentOption[]]> {
  const groups = new Map<string, AssignableSegmentOption[]>()
  const visible = segments.filter(
    (seg) => (seg.category || 'general') === (category || 'general'),
  )
  for (const seg of visible) {
    const key = (seg.assignment_group ?? '').trim() || 'sin_grupo'
    const list = groups.get(key) ?? []
    list.push(seg)
    groups.set(key, list)
  }
  return [...groups.entries()]
}

type AssignableSegmentsAccordionProps = {
  assignableSegments: AssignableSegmentOption[]
  category?: string | null
  currentSegmentSlugs: string[]
  busySlug?: string
  onToggle: (slug: string) => void
  /** Si true, muestra acordeón por grupo (opciones del chat). */
  accordion?: boolean
}

export function AssignableSegmentsAccordion({
  assignableSegments,
  category = null,
  currentSegmentSlugs,
  busySlug = '',
  onToggle,
  accordion = false,
}: AssignableSegmentsAccordionProps) {
  const { theme } = useTheme()
  const grouped = useMemo(
    () => groupAssignableSegments(assignableSegments, category),
    [assignableSegments, category],
  )
  const assignableSlugs = useMemo(
    () => new Set(assignableSegments.map((s) => s.slug)),
    [assignableSegments],
  )
  const activeAssignableSlugs = useMemo(
    () =>
      new Set(currentSegmentSlugs.filter((slug) => assignableSlugs.has(slug))),
    [currentSegmentSlugs, assignableSlugs],
  )

  const [openGroups, setOpenGroups] = useState<Set<string> | null>(null)
  const [groupsTouched, setGroupsTouched] = useState(false)

  useEffect(() => {
    if (!accordion || groupsTouched) return
    const initial = new Set<string>()
    for (const [group, segs] of grouped) {
      if (segs.some((s) => activeAssignableSlugs.has(s.slug))) {
        initial.add(group)
      }
    }
    if (initial.size === 0 && grouped[0]) initial.add(grouped[0][0])
    setOpenGroups(initial)
  }, [accordion, grouped, activeAssignableSlugs, groupsTouched])

  function toggleGroup(group: string) {
    setGroupsTouched(true)
    setOpenGroups((prev) => {
      const next = new Set(prev ?? [])
      if (next.has(group)) next.delete(group)
      else next.add(group)
      return next
    })
  }

  if (grouped.length === 0) {
    return <p className="text-sm text-muted p-2">Sin segmentos asignables</p>
  }

  return (
    <div className="inbox-assignable-groups space-y-2">
      {grouped.map(([group, segs]) => {
        const isOpen = !accordion || (openGroups?.has(group) ?? false)
        const activeCount = segs.filter((s) =>
          activeAssignableSlugs.has(s.slug),
        ).length
        return (
          <div key={group} className="inbox-assignable-group">
            {accordion ? (
              <button
                type="button"
                className="inbox-assignable-group__header"
                aria-expanded={isOpen}
                onClick={() => toggleGroup(group)}
              >
                <span className="inbox-assignable-group__title">{group}</span>
                {activeCount > 0 ? (
                  <span className="muted inbox-assignable-group__count">
                    {activeCount}
                  </span>
                ) : null}
                <span className="inbox-assignable-group__chevron" aria-hidden>
                  {isOpen ? '▾' : '▸'}
                </span>
              </button>
            ) : (
              <p className="text-xs text-muted inbox-assignable-group__label">
                {group}
              </p>
            )}
            {isOpen ? (
              <div
                className="flex flex-wrap gap-1"
                role="group"
                aria-label={`Asignar a ${group}`}
              >
                {segs.map((seg) => {
                  const active = activeAssignableSlugs.has(seg.slug)
                  return (
                    <button
                      key={seg.slug}
                      type="button"
                      role="checkbox"
                      aria-checked={active}
                      disabled={busySlug === seg.slug}
                      onClick={() => onToggle(seg.slug)}
                      className={`inbox-chat-pill contact-filter-pill ${active ? 'is-active' : ''}`}
                      style={segmentFilterPillStyle(
                        seg.color_key ?? 'slate',
                        theme,
                        active,
                      )}
                    >
                      {seg.label}
                    </button>
                  )
                })}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
