const EVENT = 'mali-categories'

function key(userId: number, area: string) {
  return `mali-categories:${userId}:${area}`
}

export function canonicalArea(area: string): string {
  if (area === 'educacion_ca' || area === 'educacion_ep') return 'educacion'
  return area
}

export function readCategorySelection(userId: number, area: string): string[] | null {
  try {
    const raw = sessionStorage.getItem(key(userId, canonicalArea(area)))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.map((item) => String(item))
  } catch {
    return null
  }
}

export function writeCategorySelection(userId: number, area: string, slugs: string[] | null) {
  const storageKey = key(userId, canonicalArea(area))
  if (!slugs) sessionStorage.removeItem(storageKey)
  else sessionStorage.setItem(storageKey, JSON.stringify(slugs))
  window.dispatchEvent(new Event(EVENT))
}

export function onCategorySelection(listener: () => void) {
  window.addEventListener(EVENT, listener)
  return () => window.removeEventListener(EVENT, listener)
}
