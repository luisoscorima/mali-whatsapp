import type { AppShellOutletContext } from '@/app/appOutletContext'
import { NavLink, Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { hasInboxDetailRoute } from '@/shared/layout/inboxDetailRoute'
import { WaPageContents } from '@/shared/ui/shell/WaLayout'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { WaMainPane, WaMainHeader, WaMainBody } from '@/shared/ui/shell/WaMainPane'
import { WaBackLink } from '@/shared/ui/shell/WaBackLink'

export type SettingsModule = {
  id: string
  path: string
  title: string
  preview: string
  navGroup?: 'ajustes' | 'reportes'
}

export type ModulesShellProps = {
  navGroup: 'ajustes' | 'reportes'
  title: string
  emptyMessage: string
  loadErrorMessage: string
  backLabel: string
  rootPath: string
}

function sectionFromPath(pathname: string, rootPath: string): string {
  const prefix = rootPath.replace(/\/$/, '')
  const part = pathname.replace(new RegExp(`^${prefix}/?`), '').split('/')[0]
  return part || ''
}

export function ModulesShell({
  navGroup,
  title,
  emptyMessage,
  loadErrorMessage,
  backLabel,
  rootPath,
}: ModulesShellProps) {
  const appContext = useOutletContext<AppShellOutletContext>()
  const location = useLocation()
  const [modules, setModules] = useState<SettingsModule[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const active = sectionFromPath(location.pathname, rootPath)

  useEffect(() => {
    apiClient
      .get<{ modules: SettingsModule[]; first_path: string | null }>(
        `/api/settings/modules?group=${navGroup}`,
      )
      .then((result) => {
        if (!result.ok) {
          notify.error(result.error)
          setLoadFailed(true)
          setReady(true)
          return
        }
        setModules(result.data.modules)
        setReady(true)
      })
  }, [navGroup])

  if (!ready) {
    return (
      <WaPageContents>
        <WaMainPane spanColumns>
          <p className="p-4 text-muted">Cargando…</p>
        </WaMainPane>
      </WaPageContents>
    )
  }

  if (loadFailed) {
    return (
      <WaPageContents>
        <WaMainPane spanColumns>
          <p className="p-4 text-muted">{loadErrorMessage}</p>
        </WaMainPane>
      </WaPageContents>
    )
  }

  if (!modules.length) {
    return (
      <WaPageContents>
        <WaMainPane spanColumns>
          <div className="p-6">
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-muted">{emptyMessage}</p>
          </div>
        </WaMainPane>
      </WaPageContents>
    )
  }

  return (
    <WaPageContents>
      <WaSidebar title={title}>
        <ul className="inbox-chat-list">
          {modules.map((mod) => {
            const modSection = mod.path.replace(`${rootPath}/`, '')
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
            <WaBackLink to={rootPath} label={backLabel} mobileOnly />
          </WaMainHeader>
        ) : null}
        <WaMainBody variant="form">
          <Outlet context={{ ...appContext, modules }} />
        </WaMainBody>
      </WaMainPane>
    </WaPageContents>
  )
}
