import { Badge } from '@/shared/ui/shadcn/badge'

export type ConversationBadgeInput = {
  status: string | null
  assignedUserLabel: string | null
  automationTouchedAt: string | null
}

export function ConversationBadges({
  status,
  assignedUserLabel,
  automationTouchedAt,
}: ConversationBadgeInput) {
  const mode = String(status ?? '').toLowerCase()
  const assignee = assignedUserLabel?.trim() || null
  const hasAssignee = Boolean(assignee)
  const isBot = mode === 'bot'
  const isHuman = mode === 'human'

  if (hasAssignee) {
    return (
      <span className="inbox-chat-badges">
        <Badge variant="success" title={`Asignado a ${assignee}`}>
          {assignee}
        </Badge>
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
      </span>
    )
  }

  if (isHuman) {
    const queueLabel = automationTouchedAt ? 'Sin asignar' : 'Nuevo'
    return (
      <span className="inbox-chat-badges">
        <Badge
          variant={automationTouchedAt ? 'secondary' : 'outline'}
          title={queueLabel}
        >
          {queueLabel}
        </Badge>
      </span>
    )
  }

  return null
}
