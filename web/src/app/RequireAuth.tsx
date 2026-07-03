import { useEffect, useState } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { apiClient } from '../shared/api'

export function RequireAuth() {
  const location = useLocation()
  const [allowed, setAllowed] = useState<boolean | null>(null)

  useEffect(() => {
    apiClient.getMe().then((result) => setAllowed(result.ok))
  }, [])

  if (allowed === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Cargando sesión…
      </div>
    )
  }

  if (!allowed) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }

  return <Outlet />
}
