import type { ReactNode } from 'react'

type WaMainPaneProps = {
  children: ReactNode
  className?: string
  spanColumns?: boolean
}

export function WaMainPane({
  children,
  className = '',
  spanColumns,
}: WaMainPaneProps) {
  return (
    <section
      className={`inbox-main inbox-layout-wa ${spanColumns ? 'inbox-main--span' : ''} ${className}`}
      aria-label="Panel principal"
    >
      {children}
    </section>
  )
}

type WaMainHeaderProps = {
  children: ReactNode
}

export function WaMainHeader({ children }: WaMainHeaderProps) {
  return <header className="inbox-chat-header">{children}</header>
}

type WaMainBodyProps = {
  children: ReactNode
  variant?: 'thread' | 'form'
}

export function WaMainBody({ children, variant = 'thread' }: WaMainBodyProps) {
  return (
    <div
      className={`inbox-chat-body ${variant === 'form' ? 'inbox-chat-body--form' : ''}`}
    >
      {variant === 'thread' ? (
        <div className="chat-thread--inbox">{children}</div>
      ) : (
        children
      )}
    </div>
  )
}

type WaMainFooterProps = {
  children: ReactNode
}

export function WaMainFooter({ children }: WaMainFooterProps) {
  return <footer className="inbox-compose">{children}</footer>
}
