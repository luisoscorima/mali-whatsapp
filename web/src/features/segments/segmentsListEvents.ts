type SegmentListItem = {
  id: number
  slug: string
  label: string
  sort_order: number
  color_key: string
  active: boolean
  show_in_filter: boolean
  assignable: boolean
  assignment_group: string | null
  created_at: string
}

/** Refresco completo de la lista (crear / borrar). */
export const SEGMENTS_LIST_REFRESH_EVENT = 'mali:segments-list-refresh'

/** Parchea un ítem en la lista con datos ya conocidos (tras guardar). */
export const SEGMENTS_LIST_UPSERT_EVENT = 'mali:segments-list-upsert'

export function notifySegmentsListRefresh() {
  window.dispatchEvent(new Event(SEGMENTS_LIST_REFRESH_EVENT))
}

export function notifySegmentsListUpsert(segment: SegmentListItem) {
  window.dispatchEvent(
    new CustomEvent(SEGMENTS_LIST_UPSERT_EVENT, { detail: segment }),
  )
}
