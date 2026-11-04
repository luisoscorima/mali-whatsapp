import type { ReactNode } from 'react'

type ModulePageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
  children?: ReactNode
}

export function ModulePageHeader({
  title,
  description,
  actions,
  children,
}: ModulePageHeaderProps) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">{title}</h1>
          {description ? (
            <p className="mt-1 text-sm text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}
