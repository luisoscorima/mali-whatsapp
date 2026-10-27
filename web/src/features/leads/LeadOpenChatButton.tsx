import { Link } from 'react-router-dom'
import { useOpenContactChat } from '../contacts/openContactChat'

type LeadOpenChatButtonProps = {
  contactId?: number | null
  conversationId?: number | null
  /** true si el origen se captó con inbound WA (p. ej. CTWA), no solo como contacto */
  cameWithInbound?: boolean
}

function ChatIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="17"
      height="17"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  )
}

export function LeadOpenChatButton({
  contactId,
  conversationId,
  cameWithInbound = false,
}: LeadOpenChatButtonProps) {
  const { openContactChat, linePickerDialog, busy } = useOpenContactChat()

  const title = cameWithInbound
    ? conversationId
      ? 'Abrir chat'
      : 'Abrir o crear chat'
    : conversationId
      ? 'Abrir chat (captado solo como contacto)'
      : contactId
        ? 'Abrir o crear chat (captado solo como contacto)'
        : 'Sin contacto vinculado'

  const contactOnlyLabel = busy ? '…' : 'Solo contacto'

  if (conversationId) {
    return (
      <div className="flex flex-col items-start gap-0.5">
        <Link
          to={`/conversations/${conversationId}`}
          className="contact-row-action-btn"
          title={title}
          aria-label={title}
        >
          <ChatIcon />
        </Link>
        {!cameWithInbound ? (
          <span className="text-[10px] leading-none text-muted">
            Solo contacto
          </span>
        ) : null}
      </div>
    )
  }

  if (contactId) {
    return (
      <>
        <div className="flex flex-col items-start gap-0.5">
          <button
            type="button"
            className="contact-row-action-btn disabled:opacity-60"
            title={title}
            aria-label={title}
            disabled={busy}
            onClick={() => void openContactChat(contactId)}
          >
            <ChatIcon />
          </button>
          {!cameWithInbound ? (
            <span className="text-[10px] leading-none text-muted">
              {contactOnlyLabel}
            </span>
          ) : null}
        </div>
        {linePickerDialog}
      </>
    )
  }

  return <span className="text-muted">—</span>
}
