import { useCallback, useEffect, useState } from 'react'
import {
  applyPalette,
  initPalette,
  readStoredPalette,
  type PaletteId,
} from './palettes'

export function usePalette() {
  const [palette, setPalette] = useState<PaletteId>(() => {
    if (typeof document === 'undefined') return 'teal'
    const current = document.documentElement.dataset.palette
    return current === 'blue' ||
      current === 'violet' ||
      current === 'emerald' ||
      current === 'rose' ||
      current === 'amber'
      ? current
      : 'teal'
  })

  useEffect(() => {
    initPalette()
    const stored = readStoredPalette()
    if (stored) setPalette(stored)
  }, [])

  const setPaletteChoice = useCallback((id: PaletteId) => {
    applyPalette(id)
    setPalette(id)
  }, [])

  return { palette, setPalette: setPaletteChoice }
}
