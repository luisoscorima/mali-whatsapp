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
  const queueLabel =
    isHuman && !hasAssignee
      ? automationTouchedAt
        ? 'Sin asignar'
        : 'Nuevo'
      : null

  if (!isBot && !isHuman && !hasAssignee) return null

  return (
    <span className="inbox-chat-badges">
      {isBot ? (
        <Badge variant="default" title="Modo Bot">
          Bot
        </Badge>
      ) : null}
      {queueLabel ? (
        <Badge
          variant={automationTouchedAt ? 'secondary' : 'outline'}
          title={queueLabel}
        >
          {queueLabel}
        </Badge>
      ) : null}
      {hasAssignee ? (
        <Badge variant="success" title={`Asignado a ${assignee}`}>
          {assignee}
        </Badge>
      ) : null}
    </span>
  )
}
