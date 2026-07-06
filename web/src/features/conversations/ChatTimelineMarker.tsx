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
}

export function ChatTimelineEventMarker({ label }: ChatTimelineEventMarkerProps) {
  return (
    <p className="chat-timeline-event muted" aria-label={label}>
      {label}
    </p>
  )
}
