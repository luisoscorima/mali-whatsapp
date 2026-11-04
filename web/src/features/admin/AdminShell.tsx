import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router-dom'
import { apiClient, type AuthUser } from '@/shared/api'
import { hasInboxDetailRoute } from '@/shared/layout/inboxDetailRoute'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { WaMainPane, WaMainHeader, WaMainBody } from '@/shared/ui/shell/WaMainPane'
import { WaBackLink } from '@/shared/ui/shell/WaBackLink'

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
    return <Navigate to="/conversations" replace />
  }
  return <Outlet />
}

type AdminLink = { to: string; label: string }

type AdminGroup = {
  title: string
  links: AdminLink[]
}

const ADMIN_GROUPS: AdminGroup[] = [
  {
    title: 'Organización',
    links: [
      { to: '/admin/users', label: 'Usuarios' },
      { to: '/admin/roles', label: 'Roles' },
      { to: '/admin/areas', label: 'Áreas' },
    ],
  },
  {
    title: 'Canales',
    links: [
      { to: '/admin/lines', label: 'Líneas' },
      { to: '/admin/meta', label: 'Credenciales Meta' },
      { to: '/admin/conflicts', label: 'Conflictos' },
    ],
  },
  {
    title: 'Auditoría',
    links: [{ to: '/admin/audit-logs', label: 'Bitácora global' }],
  },
]

const ALL_ADMIN_LINKS = ADMIN_GROUPS.flatMap((g) => g.links)

function activeAdminLabel(pathname: string): string {
  const match = ALL_ADMIN_LINKS.find((link) => pathname.startsWith(link.to))
  return match?.label ?? 'Administración'
}

export function AdminShell() {
  const location = useLocation()
  const showMobileBack = hasInboxDetailRoute(location.pathname)
  const sectionLabel = activeAdminLabel(location.pathname)

  return (
    <WaPageContents>
      <WaSidebar title="Administración">
        <div className="space-y-3">
          {ADMIN_GROUPS.map((group) => (
            <div key={group.title}>
              <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-muted">
                {group.title}
              </p>
              <ul className="inbox-chat-list">
                {group.links.map((link) => {
                  const isActive = location.pathname.startsWith(link.to)
                  return (
                    <li
                      key={link.to}
                      className={`inbox-chat-item ${isActive ? 'is-active' : ''}`}
                    >
                      <NavLink to={link.to} className="inbox-chat-link">
                        <span className="inbox-chat-title">{link.label}</span>
                      </NavLink>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      </WaSidebar>
      <WaMainPane>
        <WaMainHeader>
          {showMobileBack ? (
            <WaBackLink to="/admin" label="Volver a Administración" mobileOnly />
          ) : null}
          <h1 className="inbox-chat-heading">{sectionLabel}</h1>
          <p className="inbox-chat-sub">Solo usuario master</p>
        </WaMainHeader>
        <WaMainBody variant="form">
          <Outlet />
        </WaMainBody>
      </WaMainPane>
    </WaPageContents>
  )
}
