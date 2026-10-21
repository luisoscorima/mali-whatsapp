import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { apiClient, type AuthUser } from '../shared/api'

export function RequireAuth() {
  const location = useLocation()
  const [allowed, setAllowed] = useState<boolean | null>(null)
  const [user, setUser] = useState<AuthUser | null>(null)

  useEffect(() => {
    let cancelled = false
    apiClient
      .getSession()
      .then((result) => {
        if (cancelled) return
        setUser(result.ok ? (result.data.user ?? null) : null)
        setAllowed(
          Boolean(result.ok && result.data.authenticated && result.data.user),
        )
      })
      .catch(() => {
        if (!cancelled) setAllowed(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Cargando sesión…
      </div>
    )
  }

  if (!allowed || !user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <Outlet context={{ user, setUser }} />
}
