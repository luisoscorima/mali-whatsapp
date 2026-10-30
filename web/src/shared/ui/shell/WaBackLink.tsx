import type { ReactNode } from 'react'
import { Link, type To } from 'react-router-dom'

function BackChevron() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      aria-hidden="true"
    >
      <path d="M15 6 9 12l6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

type CommonProps = {
  label: string
  className?: string
  /** Solo visible en viewport móvil (sidebar cubre el “atrás” en desktop). */
  mobileOnly?: boolean
}

function backClassName(mobileOnly?: boolean, className = '') {
  return [
    'wa-back-btn',
    mobileOnly ? 'wa-back-btn--mobile-only' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')
}

export function WaBackLink({
  to,
  label,
  className,
  mobileOnly,
}: CommonProps & { to: To }) {
  return (
    <Link
      to={to}
      className={backClassName(mobileOnly, className)}
      aria-label={label}
      title={label}
    >
      <BackChevron />
    </Link>
  )
}

export function WaBackButton({
  onClick,
  label,
  className,
  mobileOnly,
}: CommonProps & { onClick: () => void }) {
  return (
    <button
      type="button"
      className={backClassName(mobileOnly, className)}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <BackChevron />
    </button>
  )
}

/** Agrupa atrás + título en una fila compacta. */
export function WaBackHeading({
  back,
  children,
}: {
  back: ReactNode
  children: ReactNode
}) {
  return (
    <div className="wa-back-heading">
      {back}
      <div className="wa-back-heading__body">{children}</div>
    </div>
  )
}
