import { NavLink, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiClient, onUnauthorized, type AuthUser } from '../shared/api'

export function AppShell() {
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    onUnauthorized(() => setUser(null))
    apiClient.getMe().then((result) => {
      if (result.ok) setUser(result.data)
    })
  }, [])

  function onLogout() {
    apiClient.logout()
    setUser(null)
    window.location.href = '/login'
  }

  const navItems =
    user?.isProvisioned || user?.isMaster
      ? [
          { to: '/', label: 'Panel', end: true },
          { to: '/anuncios', label: 'Anuncios' },
          { to: '/attributes', label: 'Atributos' },
          { to: '/segments', label: 'Segmentos' },
          { to: '/contacts', label: 'Contactos' },
          { to: '/templates', label: 'Plantillas' },
          { to: '/campaigns', label: 'Campañas' },
          { to: '/conversations', label: 'Conversaciones' },
          { to: '/settings', label: 'Ajustes' },
          ...(user?.isMaster ? [{ to: '/admin', label: 'Admin' }] : []),
        ]
      : [{ to: '/', label: 'Panel', end: true }]

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-line bg-surface-strong/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="text-xs font-semibold tracking-widest text-accent uppercase">
              MALI WhatsApp
            </p>
            {user ? (
              <p className="text-sm text-muted">
                {user.email} · {user.area}
                {user.isMaster ? ' · master' : ''}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
          >
            Salir
          </button>
        </div>
      </header>
      <nav className="border-b border-line bg-surface-strong/50">
        <div className="mx-auto flex max-w-6xl gap-1 px-4 py-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-3 py-1.5 text-sm ${
                  isActive
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-muted hover:bg-accent-soft'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
