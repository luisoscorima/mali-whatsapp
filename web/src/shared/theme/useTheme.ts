import { useCallback, useEffect, useState } from 'react'

const THEME_KEY = 'mali-theme'
const THEME_COLOR = { light: '#e5ede9', dark: '#0b141a' } as const
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

function updateMobileMeta(theme: Theme) {
  const themeColor = document.querySelector('meta[name="theme-color"]')
  if (themeColor) themeColor.setAttribute('content', THEME_COLOR[theme])

  const appleStatus = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]')
  if (appleStatus) {
    appleStatus.setAttribute('content', theme === 'dark' ? 'black-translucent' : 'default')
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  updateMobileMeta(theme)
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
