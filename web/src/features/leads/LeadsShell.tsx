import { Outlet, useLocation, useOutletContext } from 'react-router-dom'
import type { AppShellOutletContext } from '@/app/appOutletContext'
import { WaSpanMainPage } from '../../shared/ui/shell/WaSpanMainPage'

/** Full-width shell for /leads hub and Instant Forms; CTWA uses MetaAdsShell. */
export function LeadsShell() {
  const context = useOutletContext<AppShellOutletContext>()
  const { pathname } = useLocation()
  const isCtwa = pathname.includes('/leads/meta-ctwa')
  if (isCtwa) return <Outlet context={context} />
  return (
    <WaSpanMainPage variant="history">
      <Outlet context={context} />
    </WaSpanMainPage>
  )
}
