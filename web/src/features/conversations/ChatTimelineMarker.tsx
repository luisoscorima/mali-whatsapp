type ChatTimelineDateMarkerProps = {
  label: string
}

export function ChatTimelineDateMarker({ label }: ChatTimelineDateMarkerProps) {
  return (
    <div className="chat-timeline-date" role="separator" aria-label={label}>
      <span className="chat-timeline-date__label">{label}</span>
    </div>
  )
}

type ChatTimelineEventMarkerProps = {
  label: string
  action?: 'view_scheduled'
  onAction?: () => void
}

export function ChatTimelineEventMarker({
  label,
  action,
  onAction,
}: ChatTimelineEventMarkerProps) {
  if (action === 'view_scheduled') {
    return (
      <div className="chat-timeline-event chat-timeline-event--pill" role="status">
        <span className="chat-timeline-event__pill" aria-label={label}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <circle cx="12" cy="12" r="9" />
            <polyline points="12 7 12 12 15.5 14" />
          </svg>
          <span>{label}</span>
          {onAction ? (
            <button
              type="button"
              className="chat-timeline-event__link"
              onClick={onAction}
            >
              Ver
            </button>
          ) : null}
        </span>
      </div>
    )
  }

  return (
    <p className="chat-timeline-event muted" aria-label={label}>
      {label}
    </p>
  )
}
