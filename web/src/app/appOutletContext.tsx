import { Navigate, useOutletContext } from 'react-router-dom'
import type { AuthUser } from '@/shared/api'
import { defaultHomePath } from '@/shared/auth/permissions'

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

/** Redirige al home permitido si el usuario no tiene el permiso. */
export function RequireUserPermission({
  allowed,
  children,
}: RequireUserPermissionProps) {
  const user = useAppUser()
  if (user && !allowed(user)) {
    return <Navigate to={defaultHomePath(user)} replace />
  }
  return <>{children}</>
}

export function HomeRedirect() {
  const user = useAppUser()
  return <Navigate to={defaultHomePath(user)} replace />
}
