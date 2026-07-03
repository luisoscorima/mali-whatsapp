import { useEffect, useState } from 'react'
import { Navigate, Outlet } from 'react-router-dom'
import { apiClient } from '../shared/api'

export function RequirePasswordChanged() {
  const [mustChange, setMustChange] = useState<boolean | null>(null)

  useEffect(() => {
    apiClient.getMe().then((result) => {
      if (!result.ok) {
        setMustChange(false)
        return
      }
      setMustChange(Boolean(result.data.mustChangePassword))
    })
  }, [])

  if (mustChange === null) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Cargando sesión…
      </div>
    )
  }

  if (mustChange) {
    return <Navigate to="/account/change-password" replace />
  }

  return <Outlet />
}
