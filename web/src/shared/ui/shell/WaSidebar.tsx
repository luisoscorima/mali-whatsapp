import type { ReactNode } from 'react'
import { ScrollArea } from '../shadcn/scroll-area'
import { WaRefreshBtn } from './WaEmptyPane'

type WaSidebarProps = {
  title: string
  actions?: ReactNode
  filters?: ReactNode
  onRefresh?: () => void
  refreshTitle?: string
  children: ReactNode
  className?: string
  hiddenOnMobile?: boolean
}

export function WaSidebar({
  title,
  actions,
  filters,
  onRefresh,
  refreshTitle,
  children,
  className = '',
  hiddenOnMobile,
}: WaSidebarProps) {
  return (
    <aside
      className={`inbox-sidebar ${hiddenOnMobile ? 'max-md:hidden' : ''} ${className}`}
      aria-label={title}
    >
      <div className="inbox-sidebar-header inbox-sidebar-header--with-actions">
        <h2 className="inbox-sidebar-title">{title}</h2>
        <div className="inbox-sidebar-toolbar">
          {actions}
          {onRefresh ? (
            <WaRefreshBtn onClick={onRefresh} title={refreshTitle ?? 'Actualizar'} />
          ) : null}
        </div>
      </div>
      {filters}
      <ScrollArea className="min-h-0 flex-1">{children}</ScrollArea>
    </aside>
  )
}
