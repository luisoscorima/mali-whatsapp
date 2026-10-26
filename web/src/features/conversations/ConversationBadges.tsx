import { Badge } from '@/shared/ui/shadcn/badge'

export type ConversationBadgeInput = {
  status: string | null
  assignedUserLabel: string | null
  hideAssignee?: boolean
  archived?: boolean
  unanswered?: boolean
}

export function ConversationBadges({
  status,
  assignedUserLabel,
  hideAssignee = false,
  archived = false,
  unanswered = false,
}: ConversationBadgeInput) {
  const mode = String(status ?? '').toLowerCase()
  const assignee = assignedUserLabel?.trim() || null
  const hasAssignee = Boolean(assignee)
  const isBot = mode === 'bot'
  const isHuman = mode === 'human'
  const archiveBadge = archived ? (
    <Badge variant="secondary" title="Chat archivado">
      Archivado
    </Badge>
  ) : unanswered ? (
    <Badge variant="secondary" title="Sin respuesta del contacto">
      Sin respuesta
    </Badge>
  ) : null

  if (hasAssignee) {
    return (
      <span className="inbox-chat-badges">
        {!hideAssignee ? <Badge variant="success" title={`Asignado a ${assignee}`}>
          {assignee}
        </Badge> : null}
        {archiveBadge}
      </span>
    )
  }

  if (isBot) {
    return (
      <span className="inbox-chat-badges">
        <Badge variant="default" title="Modo Bot">
          Bot
        </Badge>
        <Badge variant="secondary" title="Sin asignar">
          Sin asignar
        </Badge>
        {archiveBadge}
      </span>
    )
  }

  if (isHuman) {
    return (
      <span className="inbox-chat-badges">
        <Badge variant="secondary" title="Sin asignar">
          Sin asignar
        </Badge>
        {archiveBadge}
      </span>
    )
  }

  if (archiveBadge) {
    return <span className="inbox-chat-badges">{archiveBadge}</span>
  }

  return null
}
