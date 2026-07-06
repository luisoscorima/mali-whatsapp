import { cn } from '@/lib/utils'

export type MessageDeliveryInfo = {
  status: 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
  label: string
}

type ChatDeliveryStatusProps = {
  delivery: MessageDeliveryInfo
}

export function ChatDeliveryStatus({ delivery }: ChatDeliveryStatusProps) {
  const statusClass =
    delivery.status === 'read'
      ? 'chat-delivery--read'
      : delivery.status === 'failed'
        ? 'chat-delivery--failed'
        : delivery.status === 'delivered'
          ? 'chat-delivery--delivered'
          : 'chat-delivery--sent'

  return (
    <div
      className={cn('chat-delivery-row', statusClass)}
      title={delivery.label}
      aria-label={delivery.label}
    >
      {delivery.status === 'failed' ? (
        <span className="chat-delivery-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
        </span>
      ) : delivery.status === 'read' ? (
        <span className="chat-delivery-icon chat-delivery-icon--dbl" aria-hidden="true">
          <svg width="18" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12l5 5L22 5" />
            <path d="M8 12l3 3L22 5" />
          </svg>
        </span>
      ) : delivery.status === 'delivered' ? (
        <span className="chat-delivery-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M20 6L9 17l-5-5" />
          </svg>
        </span>
      ) : (
        <span className="chat-delivery-icon" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 8v4l3 3M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </span>
      )}
      <span className="chat-delivery-label">{delivery.label}</span>
    </div>
  )
}
