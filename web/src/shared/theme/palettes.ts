export const PALETTE_STORAGE_KEY = 'mali-palette'

export type PaletteId = 'teal' | 'blue' | 'violet' | 'emerald' | 'rose' | 'amber'

export type PaletteOption = {
  id: PaletteId
  label: string
  swatch: string
}

/** Metadatos para el selector; los valores viven en palettes.css */
export const PALETTE_OPTIONS: PaletteOption[] = [
  { id: 'teal', label: 'Verde', swatch: '#0d6e5c' },
  { id: 'blue', label: 'Azul', swatch: '#2563eb' },
  { id: 'violet', label: 'Violeta', swatch: '#7c3aed' },
  { id: 'emerald', label: 'Esmeralda', swatch: '#059669' },
  { id: 'rose', label: 'Rosa', swatch: '#db2777' },
  { id: 'amber', label: 'Ámbar', swatch: '#d97706' },
]

const VALID_IDS = new Set<string>(PALETTE_OPTIONS.map((p) => p.id))

export function isPaletteId(value: string | null | undefined): value is PaletteId {
  return value != null && VALID_IDS.has(value)
}

export function readStoredPalette(): PaletteId | null {
  try {
    const stored = localStorage.getItem(PALETTE_STORAGE_KEY)
    if (isPaletteId(stored)) return stored
  } catch {
    /* ignore */
  }
  return null
}

export function applyPalette(id: PaletteId) {
  document.documentElement.dataset.palette = id
  try {
    localStorage.setItem(PALETTE_STORAGE_KEY, id)
  } catch {
    /* ignore */
  }
}

export function initPalette() {
  applyPalette(readStoredPalette() ?? 'teal')
}
