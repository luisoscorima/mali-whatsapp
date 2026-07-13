import { useEffect, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { AuthUser } from '@/shared/api'
import { MALI_LOGO_URL } from '@/shared/brand'
import { useTheme } from '@/shared/theme/useTheme'

import { WaAccountMenu } from '@/shared/ui/shell/WaAccountMenu'

const MORE_NAV = ['segments', 'templates', 'attributes', 'anuncios'] as const

export function navFromPath(pathname: string): string {
  if (pathname.startsWith('/conversations')) return 'conversations'
  if (pathname.startsWith('/campaigns')) return 'campaigns'
  if (pathname.startsWith('/contacts')) return 'contacts'
  if (pathname.startsWith('/segments')) return 'segments'
  if (pathname.startsWith('/templates')) return 'templates'
  if (pathname.startsWith('/attributes')) return 'attributes'
  if (pathname.startsWith('/anuncios')) return 'anuncios'
  if (pathname.startsWith('/settings')) return 'settings'
  if (pathname.startsWith('/admin')) return 'admin'
  if (pathname === '/') return 'conversations'
  return ''
}

type NavItem = {
  key: string
  to: string
  label: string
  mobileSecondary?: boolean
  icon: React.ReactNode
}

const NAV_ITEMS: NavItem[] = [
  {
    key: 'conversations',
    to: '/conversations',
    label: 'Conversaciones',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
      </svg>
    ),
  },
  {
    key: 'campaigns',
    to: '/campaigns',
    label: 'Campañas',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 2L11 13" />
        <path d="M22 2l-7 20-4-9-9-4 20-7z" />
      </svg>
    ),
  },
  {
    key: 'contacts',
    to: '/contacts',
    label: 'Contactos',
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
  },
  {
    key: 'segments',
    to: '/segments',
    label: 'Segmentos',
    mobileSecondary: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
        <line x1="7" y1="7" x2="7.01" y2="7" />
      </svg>
    ),
  },
  {
    key: 'templates',
    to: '/templates',
    label: 'Plantillas',
    mobileSecondary: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="7" y1="8" x2="17" y2="8" />
        <line x1="7" y1="12" x2="14" y2="12" />
        <line x1="7" y1="16" x2="12" y2="16" />
      </svg>
    ),
  },
  {
    key: 'attributes',
    to: '/attributes',
    label: 'Atributos',
    mobileSecondary: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h10M4 18h6" />
        <circle cx="17" cy="17" r="3" />
      </svg>
    ),
  },
  {
    key: 'anuncios',
    to: '/anuncios',
    label: 'Anuncios',
    mobileSecondary: true,
    icon: (
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M7 7h4v4H7zM13 7h4v4h-4zM7 13h4v4H7zM13 13h3v4h-3z" />
      </svg>
    ),
  },
]

type WaRailProps = {
  user: AuthUser | null
  onUserUpdate?: (user: AuthUser) => void
}

export function WaRail({ user, onUserUpdate }: WaRailProps) {
  const location = useLocation()
  const { toggleTheme } = useTheme()
  const moreRef = useRef<HTMLDetailsElement>(null)
  const nav = navFromPath(location.pathname)
  const mobileMoreActive = MORE_NAV.includes(nav as (typeof MORE_NAV)[number])

  useEffect(() => {
    function onDocClick(ev: MouseEvent) {
      const el = moreRef.current
      if (!el?.open) return
      if (!el.contains(ev.target as Node)) el.open = false
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [])

  useEffect(() => {
    if (moreRef.current) moreRef.current.open = false
  }, [location.pathname])

  const provisionedItems =
    user?.isProvisioned || user?.isMaster
      ? NAV_ITEMS
      : NAV_ITEMS.filter((item) => item.key === 'campaigns' || item.key === 'conversations')

  const visibleItems = provisionedItems.filter((item) => {
    if (item.key === 'attributes') return Boolean(user?.canManageAttributes)
    if (item.key === 'segments') return Boolean(user?.canManageSegments)
    return true
  })

  return (
    <aside className="wa-rail" aria-label="Navegación principal">
      <div className="wa-rail__brand">
        <Link to="/conversations" className="wa-rail__logo-link" title="MALI WhatsApp" aria-label="Inicio">
          <span className="wa-rail__logo-wrap" aria-hidden="true">
            <img className="wa-rail__logo" src={MALI_LOGO_URL} alt="MALI" width="40" height="40" decoding="async" />
          </span>
        </Link>
      </div>

      <nav className="wa-rail__nav" aria-label="Secciones">
        {visibleItems.map((item) => (
          <Link
            key={item.key}
            to={item.to}
            className={`wa-rail__item nav-item ${item.mobileSecondary ? 'wa-rail__item--mobile-secondary' : ''} ${nav === item.key ? 'is-active' : ''}`}
            aria-label={item.label}
            title={item.label}
          >
            <span className="wa-rail__icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="wa-rail__label">{item.label}</span>
          </Link>
        ))}

        <details ref={moreRef} className={`wa-rail__more ${mobileMoreActive ? 'is-active' : ''}`}>
          <summary className="wa-rail__item wa-rail__item--more" aria-label="Más secciones" title="Más">
            <span className="wa-rail__icon" aria-hidden="true">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="1.5" />
                <circle cx="19" cy="12" r="1.5" />
                <circle cx="5" cy="12" r="1.5" />
              </svg>
            </span>
            <span className="wa-rail__label">Más</span>
          </summary>
          <div className="wa-rail__more-panel" role="menu" aria-label="Más secciones">
            {visibleItems
              .filter((item) => item.mobileSecondary)
              .map((item) => (
                <Link
                  key={item.key}
                  to={item.to}
                  className={nav === item.key ? 'is-active' : ''}
                  role="menuitem"
                  onClick={() => {
                    if (moreRef.current) moreRef.current.open = false
                  }}
                >
                  {item.label}
                </Link>
              ))}
          </div>
        </details>
      </nav>

      <div className="wa-rail__footer">
        <button
          type="button"
          className="wa-rail__theme theme-toggle"
          onClick={toggleTheme}
          title="Modo claro / oscuro"
          aria-label="Cambiar tema"
        >
          <span className="wa-rail__icon" aria-hidden="true">
            ◐
          </span>
        </button>

        {user ? <WaAccountMenu user={user} onUserUpdate={onUserUpdate} /> : null}
      </div>
    </aside>
  )
}
