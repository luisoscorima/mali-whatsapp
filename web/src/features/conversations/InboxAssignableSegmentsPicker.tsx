import { useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import {
  AssignableSegmentsAccordion,
  type AssignableSegmentOption,
} from './assignableSegmentsUi'

type InboxAssignableSegmentsPickerProps = {
  contactId: number
  category?: string | null
  assignableSegments: AssignableSegmentOption[]
  currentSegmentSlugs: string[]
  accordion?: boolean
  onChanged?: () => void
}

export function InboxAssignableSegmentsPicker({
  contactId,
  category = null,
  assignableSegments,
  currentSegmentSlugs,
  accordion = true,
  onChanged,
}: InboxAssignableSegmentsPickerProps) {
  const [busySlug, setBusySlug] = useState('')

  async function toggle(slug: string) {
    setBusySlug(slug)
    const res = await apiClient.patch<{ segment_slugs: string[] }>(
      `/api/contacts/${contactId}/assignable-segment`,
      { segment_slug: slug, category: category || undefined },
    )
    setBusySlug('')
    if (!res.ok) {
      notify.error(res.error)
      return
    }
    onChanged?.()
  }

  return (
    <div className="inbox-oneclick-picker p-1">
      <AssignableSegmentsAccordion
        assignableSegments={assignableSegments}
        category={category}
        currentSegmentSlugs={currentSegmentSlugs}
        busySlug={busySlug}
        accordion={accordion}
        onToggle={(slug) => void toggle(slug)}
      />
    </div>
  )
}
