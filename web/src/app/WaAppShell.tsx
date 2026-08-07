import { Outlet, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { apiClient, onUnauthorized, type AuthUser } from '@/shared/api'
import { hasInboxDetailRoute } from '@/shared/layout/inboxDetailRoute'
import { TooltipProvider } from '@/shared/ui/shadcn/tooltip'
import { WaLayout } from '@/shared/ui/shell/WaLayout'
import { WaRail } from '@/shared/ui/shell/WaRail'
import type { AppShellOutletContext } from './appOutletContext'

const UNREAD_POLL_MS = 8000

export function WaAppShell() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [conversationsUnreadCount, setConversationsUnreadCount] = useState(0)
  const location = useLocation()
  const isConversations = location.pathname.startsWith('/conversations')
  const hasInboxDetail = hasInboxDetailRoute(location.pathname)

  useEffect(() => {
    onUnauthorized(() => setUser(null))
    apiClient.getMe().then((result) => {
      if (result.ok) setUser(result.data)
    })
  }, [])

  useEffect(() => {
    if (!user) {
      setConversationsUnreadCount(0)
      return
    }
    let cancelled = false
    async function tick() {
      const result = await apiClient.get<{ unread_count?: number }>(
        '/api/conversations?chat=all&page=1',
      )
      if (cancelled || !result.ok) return
      setConversationsUnreadCount(Math.max(0, result.data.unread_count ?? 0))
    }
    void tick()
    const timer = window.setInterval(() => void tick(), UNREAD_POLL_MS)
    function onVisibility() {
      if (document.visibilityState === 'visible') void tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user?.id])

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
          <WaRail
            user={user}
            onUserUpdate={setUser}
            conversationsUnreadCount={conversationsUnreadCount}
          />
          <Outlet context={outletContext} />
        </WaLayout>
      </div>
    </TooltipProvider>
  )
}
