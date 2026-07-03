import { Outlet } from 'react-router-dom'
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
      <main className="mx-auto max-w-6xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  )
}
