import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'

export function SettingsIndexPage() {
  const [firstPath, setFirstPath] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    apiClient
      .get<{ first_path: string | null }>('/api/settings/modules')
      .then((result) => {
        if (!result.ok) {
          setFirstPath(null)
          return
        }
        setFirstPath(result.data.first_path)
      })
  }, [])

  if (firstPath === undefined) {
    return <p className="text-muted">Cargando ajustes…</p>
  }

  if (!firstPath) {
    return (
      <p className="text-muted">No tienes acceso a ningún módulo de ajustes.</p>
    )
  }

  return <Navigate to={firstPath} replace />
}
