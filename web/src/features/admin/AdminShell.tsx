import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { apiClient, type AuthUser } from '@/shared/api'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { WaMainPane, WaMainHeader, WaMainBody } from '@/shared/ui/shell/WaMainPane'

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
    return (
      <WaPageContents>
        <WaMainPane spanColumns>
          <p className="p-4 text-muted">Cargando…</p>
        </WaMainPane>
      </WaPageContents>
    )
  }
  if (!user?.isMaster) {
    return <Navigate to="/" replace />
  }
  return <Outlet />
}

const ADMIN_LINKS = [
  { to: '/admin/users', label: 'Usuarios' },
  { to: '/admin/meta', label: 'Credenciales Meta' },
  { to: '/admin/audit-logs', label: 'Bitácora' },
]

export function AdminShell() {
  const location = useLocation()

  return (
    <WaPageContents>
      <WaSidebar title="Administración">
        <ul className="inbox-chat-list">
          {ADMIN_LINKS.map((link) => {
            const isActive = location.pathname.startsWith(link.to)
            return (
              <li key={link.to} className={`inbox-chat-item ${isActive ? 'is-active' : ''}`}>
                <NavLink to={link.to} className="inbox-chat-link">
                  <span className="inbox-chat-title">{link.label}</span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      </WaSidebar>
      <WaMainPane>
        <WaMainHeader>
          <h1 className="inbox-chat-heading">Administración</h1>
          <p className="inbox-chat-sub">Solo usuario master</p>
        </WaMainHeader>
        <WaMainBody variant="form">
          <Outlet />
        </WaMainBody>
      </WaMainPane>
    </WaPageContents>
  )
}
