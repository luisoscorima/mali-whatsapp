import { Outlet, useLocation, useOutletContext } from 'react-router-dom'
import { Suspense, useEffect, useState } from 'react'
import { apiClient, onUnauthorized } from '@/shared/api'
import { areaLabel } from '@/features/admin/areaLabels'
import { LeadAlertsProvider } from '@/features/leads/leadAlertsContext'
import { hasInboxDetailRoute } from '@/shared/layout/inboxDetailRoute'
import { TooltipProvider } from '@/shared/ui/shadcn/tooltip'
import { WaLayout } from '@/shared/ui/shell/WaLayout'
import { WaRail } from '@/shared/ui/shell/WaRail'
import {
  connectInboxRealtime,
  disconnectInboxRealtime,
  isInboxRealtimeConnected,
  onInboxInvalidated,
  onInboxPush,
  onInboxRealtimeStatus,
} from '@/shared/realtime/inboxRealtime'
import type { AppShellOutletContext } from './appOutletContext'

const UNREAD_POLL_MS = 15000
const UNREAD_PUSH_THROTTLE_MS = 2000
const APP_TITLE = 'MALI ONE WhatsApp'

export function WaAppShell() {
  const { user, setUser } = useOutletContext<AppShellOutletContext>()
  const [conversationsUnreadCount, setConversationsUnreadCount] = useState(0)
  const location = useLocation()
  const isConversations = location.pathname.startsWith('/conversations')
  const hasInboxDetail = hasInboxDetailRoute(location.pathname)

  useEffect(() => {
    onUnauthorized(() => setUser?.(null))
    return () => onUnauthorized(() => {})
  }, [setUser])

  useEffect(() => {
    if (!user?.area) {
      document.title = APP_TITLE
      return
    }
    document.title = `${areaLabel(user.area)} | ${APP_TITLE}`
    return () => {
      document.title = APP_TITLE
    }
  }, [user?.area])

  useEffect(() => {
    if (!user) return
    connectInboxRealtime(`${user.id}:${user.area}`)
    return () => disconnectInboxRealtime()
  }, [user?.id, user?.area])

  useEffect(() => {
    if (!user) {
      setConversationsUnreadCount(0)
      return
    }
    let cancelled = false
    let inFlight = false
    let lastRun = 0
    let throttleTimer: number | null = null
    async function tick(force = false) {
      if (cancelled || inFlight || document.visibilityState === 'hidden') return
      if (!force && isInboxRealtimeConnected()) return
      inFlight = true
      lastRun = Date.now()
      try {
        const result = await apiClient.get<{ unread_count?: number }>(
          '/api/conversations/unread-count',
        )
        if (cancelled || !result.ok) return
        setConversationsUnreadCount(Math.max(0, result.data.unread_count ?? 0))
      } catch {
        // El siguiente ciclo reintenta sin bloquear la navegación.
      } finally {
        inFlight = false
      }
    }
    function requestTick() {
      if (throttleTimer != null) return
      const wait = Math.max(0, UNREAD_PUSH_THROTTLE_MS - (Date.now() - lastRun))
      throttleTimer = window.setTimeout(() => {
        throttleTimer = null
        void tick(true)
      }, wait)
    }
    void tick(true)
    const timer = window.setInterval(() => void tick(), UNREAD_POLL_MS)
    const offPush = onInboxPush((push) => {
      if (push.unread_changed) requestTick()
    })
    const offInvalidated = onInboxInvalidated(requestTick)
    const offStatus = onInboxRealtimeStatus((connected) => {
      if (connected) requestTick()
    })
    function onVisibility() {
      if (document.visibilityState === 'visible') void tick(true)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      window.clearInterval(timer)
      if (throttleTimer != null) window.clearTimeout(throttleTimer)
      offPush()
      offInvalidated()
      offStatus()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [user?.id, user?.area])

  const layoutClass = [
    isConversations ? 'conversations-page' : '',
    hasInboxDetail ? 'conversations-inbox--detail' : '',
  ]
    .filter(Boolean)
    .join(' ')

  const outletContext: AppShellOutletContext = { user }

  return (
    <TooltipProvider>
      <LeadAlertsProvider user={user}>
        <div className="page-wa page-conversations text-ink">
          <WaLayout className={layoutClass}>
            <WaRail
              user={user}
              onUserUpdate={setUser}
              conversationsUnreadCount={conversationsUnreadCount}
            />
            <Suspense
              fallback={
                <div role="status" className="p-4 text-muted">
                  Cargando…
                </div>
              }
            >
              <Outlet context={outletContext} />
            </Suspense>
          </WaLayout>
        </div>
      </LeadAlertsProvider>
    </TooltipProvider>
  )
}
