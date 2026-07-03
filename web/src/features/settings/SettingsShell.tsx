import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiClient } from '../../shared/api'

export type SettingsModule = {
  id: string
  path: string
  title: string
  preview: string
}

function sectionFromPath(pathname: string): string {
  const part = pathname.replace(/^\/settings\/?/, '').split('/')[0]
  return part || ''
}

export function SettingsShell() {
  const location = useLocation()
  const [modules, setModules] = useState<SettingsModule[]>([])
  const [loadError, setLoadError] = useState('')
  const active = sectionFromPath(location.pathname)

  useEffect(() => {
    apiClient
      .get<{ modules: SettingsModule[]; first_path: string | null }>(
        '/api/settings/modules',
      )
      .then((result) => {
        if (!result.ok) {
          setLoadError(result.error)
          return
        }
        setModules(result.data.modules)
      })
  }, [])

  if (loadError) {
    return <p className="text-bad">{loadError}</p>
  }

  if (!modules.length) {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Ajustes</h1>
        <p className="text-muted">No tienes acceso a ningún módulo de ajustes.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <aside className="w-full shrink-0 lg:w-64">
        <h1 className="mb-3 text-lg font-semibold">Ajustes</h1>
        <ul className="space-y-1 rounded-xl border border-line bg-surface-strong p-2">
          {modules.map((mod) => {
            const modSection = mod.path.replace('/settings/', '')
            const isActive = active === modSection
            return (
              <li key={mod.id}>
                <NavLink
                  to={mod.path}
                  className={`block rounded-lg px-3 py-2 text-sm ${
                    isActive
                      ? 'bg-accent-soft font-medium text-accent'
                      : 'text-ink hover:bg-surface'
                  }`}
                >
                  <span className="block">{mod.title}</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {mod.preview}
                  </span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      </aside>
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  )
}
