import type { ReactNode } from 'react'

type WaRefreshBtnProps = {
  onClick: () => void
  title?: string
  disabled?: boolean
}

export function WaRefreshBtn({
  onClick,
  title = 'Actualizar',
  disabled,
}: WaRefreshBtnProps) {
  return (
    <button
      type="button"
      className="wa-refresh-btn wa-refresh-btn--icon-only"
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
    >
      <span className="wa-refresh-btn__icon" aria-hidden="true">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-3-6.7" />
          <path d="M21 3v6h-6" />
        </svg>
      </span>
    </button>
  )
}

type WaEmptyPaneProps = {
  icon?: ReactNode
  heading?: string
  text?: string
  children?: ReactNode
  variant?: 'center' | 'history'
}

export function WaEmptyPane({
  icon,
  heading,
  text,
  children,
  variant = 'center',
}: WaEmptyPaneProps) {
  return (
    <div
      className={`inbox-empty-pane ${variant === 'history' ? 'inbox-empty-pane--history' : ''}`}
      role="status"
    >
      {children ?? (
        <div className="inbox-empty-hint">
          {icon ? <span className="inbox-empty-icon">{icon}</span> : null}
          {heading ? <h2 className="inbox-empty-heading">{heading}</h2> : null}
          {text ? <p className="inbox-empty-text">{text}</p> : null}
        </div>
      )}
    </div>
  )
}

export function ChatEmptyIcon() {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}
