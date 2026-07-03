import { Navigate, Outlet } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { apiClient, type AuthUser } from '../../shared/api'

export function RequireMaster() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    apiClient.getMe().then((result) => {
      if (result.ok) setUser(result.data)
      setReady(true)
    })
  }, [])

  if (!ready) {
    return <p className="text-muted">Cargando…</p>
  }
  if (!user?.isMaster) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}

export function AdminShell() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Administración</h1>
        <p className="text-sm text-muted">Solo usuario master</p>
      </div>
      <nav className="flex gap-2 border-b border-line pb-2">
        <NavLink
          to="/admin/users"
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-sm ${
              isActive
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-muted hover:bg-accent-soft'
            }`
          }
        >
          Usuarios
        </NavLink>
        <NavLink
          to="/admin/meta"
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-sm ${
              isActive
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-muted hover:bg-accent-soft'
            }`
          }
        >
          Credenciales Meta
        </NavLink>
        <NavLink
          to="/admin/audit-logs"
          className={({ isActive }) =>
            `rounded-lg px-3 py-1.5 text-sm ${
              isActive
                ? 'bg-accent-soft font-medium text-accent'
                : 'text-muted hover:bg-accent-soft'
            }`
          }
        >
          Bitácora
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
