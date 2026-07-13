import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiClient, onUnauthorized, type AuthUser } from '@/shared/api'
import { hasInboxDetailRoute } from '@/shared/layout/inboxDetailRoute'
import { TooltipProvider } from '@/shared/ui/shadcn/tooltip'
import { WaLayout } from '@/shared/ui/shell/WaLayout'
import { WaRail } from '@/shared/ui/shell/WaRail'
import type { AppShellOutletContext } from './appOutletContext'

export function WaAppShell() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const location = useLocation()
  const isConversations = location.pathname.startsWith('/conversations')
  const hasInboxDetail = hasInboxDetailRoute(location.pathname)

  useEffect(() => {
    onUnauthorized(() => setUser(null))
    apiClient.getMe().then((result) => {
      if (result.ok) setUser(result.data)
    })
  }, [])

  const layoutClass = [
    isConversations ? 'conversations-page' : '',
    hasInboxDetail ? 'conversations-inbox--detail' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const outletContext: AppShellOutletContext = { user }

  return (
    <TooltipProvider>
      <div className="page-wa page-conversations text-ink">
        <WaLayout className={layoutClass}>
          <WaRail user={user} onUserUpdate={setUser} />
          <Outlet context={outletContext} />
        </WaLayout>
      </div>
    </TooltipProvider>
  )
}
