import { Navigate, useOutletContext } from 'react-router-dom'
import type { AuthUser } from '@/shared/api'

export type AppShellOutletContext = {
  user: AuthUser | null
}

export function useAppUser(): AuthUser | null {
  const ctx = useOutletContext<AppShellOutletContext | undefined>()
  return ctx?.user ?? null
}

type RequireUserPermissionProps = {
  allowed: (user: AuthUser) => boolean
  children: React.ReactNode
}

/** Redirige a /conversations si el usuario cargó y no tiene el permiso. */
export function RequireUserPermission({
  allowed,
  children,
}: RequireUserPermissionProps) {
  const user = useAppUser()
  if (user && !allowed(user)) {
    return <Navigate to="/conversations" replace />
  }
  return <>{children}</>
}
