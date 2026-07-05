import type { ReactNode } from 'react'

type WaLayoutVariant = 'inbox' | 'simple' | 'span-main'

type WaLayoutProps = {
  variant?: WaLayoutVariant
  className?: string
  children: ReactNode
}

export function WaLayout({
  variant = 'inbox',
  className = '',
  children,
}: WaLayoutProps) {
  const layoutClass =
    variant === 'simple'
      ? 'wa-layout--simple'
      : variant === 'span-main'
        ? 'wa-layout--span-main'
        : 'wa-layout--inbox'

  return (
    <div
      className={`wa-layout ${layoutClass} conversations-inbox inbox-layout-wa h-full min-h-0 ${className}`}
    >
      {children}
    </div>
  )
}

export function WaPageContents({ children }: { children: ReactNode }) {
  return <div className="wa-contents">{children}</div>
}
