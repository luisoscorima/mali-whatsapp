import { useCallback, useEffect, useState } from 'react'

const THEME_KEY = 'mali-theme'
export type Theme = 'light' | 'dark'

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark' || stored === 'light') return stored
  } catch {
    /* ignore */
  }
  return null
}

function systemTheme(): Theme {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    /* ignore */
  }
}

export function initTheme() {
  applyTheme(readStoredTheme() ?? systemTheme())
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof document === 'undefined') return 'light'
    const current = document.documentElement.dataset.theme
    return current === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    const stored = readStoredTheme()
    if (stored) {
      applyTheme(stored)
      setTheme(stored)
    }
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      return next
    })
  }, [])

  return { theme, toggleTheme }
}
