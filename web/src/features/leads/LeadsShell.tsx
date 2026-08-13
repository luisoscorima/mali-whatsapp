import { Outlet, useLocation } from 'react-router-dom'
import { WaSpanMainPage } from '../../shared/ui/shell/WaSpanMainPage'

/** Full-width shell for /leads hub and Instant Forms; CTWA uses MetaAdsShell. */
export function LeadsShell() {
  const { pathname } = useLocation()
  const isCtwa = pathname.includes('/leads/meta-ctwa')
  if (isCtwa) return <Outlet />
  return (
    <WaSpanMainPage variant="history">
      <Outlet />
    </WaSpanMainPage>
  )
}
