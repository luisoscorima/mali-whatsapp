import { Navigate, Outlet, useOutletContext } from 'react-router-dom'
import type { AppShellOutletContext } from './appOutletContext'

export function RequirePasswordChanged() {
  const context = useOutletContext<AppShellOutletContext>()
  const { user } = context
  if (user?.mustChangePassword) {
    return <Navigate to="/account/change-password" replace />
  }

  return <Outlet context={context} />
}
