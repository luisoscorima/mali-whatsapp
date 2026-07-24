import type { ReactNode } from 'react'
import { ScrollArea } from '../shadcn/scroll-area'

type WaSidebarProps = {
  title: string
  actions?: ReactNode
  filters?: ReactNode
  floating?: ReactNode
  children: ReactNode
  className?: string
  hiddenOnMobile?: boolean
}

export function WaSidebar({
  title,
  actions,
  filters,
  floating,
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
        {actions ? <div className="inbox-sidebar-toolbar">{actions}</div> : null}
      </div>
      {filters ? <div className="inbox-sidebar-filters">{filters}</div> : null}
      <ScrollArea className="inbox-sidebar-scroll min-h-0 flex-1">{children}</ScrollArea>
      {floating}
    </aside>
  )
}
