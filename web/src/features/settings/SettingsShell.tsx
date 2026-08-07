import { NavLink, Outlet, useLocation, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { hasInboxDetailRoute } from '@/shared/layout/inboxDetailRoute'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { WaMainPane, WaMainHeader, WaMainBody } from '@/shared/ui/shell/WaMainPane'

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
  const [loadFailed, setLoadFailed] = useState(false)
  const active = sectionFromPath(location.pathname)

  useEffect(() => {
    apiClient
      .get<{ modules: SettingsModule[]; first_path: string | null }>(
        '/api/settings/modules',
      )
      .then((result) => {
        if (!result.ok) {
          notify.error(result.error)
          setLoadFailed(true)
          return
        }
        setModules(result.data.modules)
      })
  }, [])

  if (loadFailed) {
    return (
      <WaPageContents>
        <WaMainPane spanColumns>
          <p className="p-4 text-muted">No se pudieron cargar los ajustes.</p>
        </WaMainPane>
      </WaPageContents>
    )
  }

  if (!modules.length) {
    return (
      <WaPageContents>
        <WaMainPane spanColumns>
          <div className="p-6">
            <h1 className="text-lg font-semibold">Ajustes</h1>
            <p className="text-muted">No tienes acceso a ningún módulo de ajustes.</p>
          </div>
        </WaMainPane>
      </WaPageContents>
    )
  }

  return (
    <WaPageContents>
      <WaSidebar title="Ajustes">
        <ul className="inbox-chat-list">
          {modules.map((mod) => {
            const modSection = mod.path.replace('/settings/', '')
            const isActive = active === modSection
            return (
              <li key={mod.id} className={`inbox-chat-item ${isActive ? 'is-active' : ''}`}>
                <NavLink to={mod.path} className="inbox-chat-link">
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-title">{mod.title}</span>
                    <span className="inbox-chat-preview">{mod.preview}</span>
                  </span>
                </NavLink>
              </li>
            )
          })}
        </ul>
      </WaSidebar>
      <WaMainPane>
        {hasInboxDetailRoute(location.pathname) ? (
          <WaMainHeader>
            <Link to="/settings" className="inbox-back-mobile">
              ← Ajustes
            </Link>
          </WaMainHeader>
        ) : null}
        <WaMainBody variant="form">
          <Outlet context={{ modules }} />
        </WaMainBody>
      </WaMainPane>
    </WaPageContents>
  )
}
