import { useMemo, useState } from 'react'

export type SavedView = { name: string; query: string }

function readViews(key: string): SavedView[] {
  try {
    const views: unknown = JSON.parse(localStorage.getItem(key) ?? '[]')
    return Array.isArray(views)
      ? views.filter((view): view is SavedView =>
          typeof view?.name === 'string' && typeof view.query === 'string',
        )
      : []
  } catch {
    return []
  }
}

export function useInboxSavedViews(storageKey: string | null) {
  const initial = useMemo(() => storageKey ? readViews(storageKey) : [], [storageKey])
  const [saved, setSaved] = useState<{ key: string; views: SavedView[] } | null>(null)
  const views = saved?.key === storageKey ? saved.views : initial

  function saveViews(next: SavedView[]) {
    if (!storageKey) return false
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setSaved({ key: storageKey, views: next })
      return true
    } catch {
      return false
    }
  }

  return { views, saveViews }
}
