const DISPLAY_TIMEZONE = 'America/Lima'

export type InboxTimelineEvent = {
  id: string
  created_at: string
  label: string
}

export type InboxMessageForTimeline = {
  id: number
  message_type: string
  created_at: string
}

function dayKey(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: DISPLAY_TIMEZONE })
}

export function formatTimelineDateLabel(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const now = new Date()
  const dk = dayKey(date)
  if (dk === dayKey(now)) return 'Hoy'
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (dk === dayKey(yesterday)) return 'Ayer'
  return date.toLocaleDateString('es-PE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: DISPLAY_TIMEZONE,
  })
}

export type ChatTimelineItem =
  | { type: 'date'; key: string; label: string }
  | { type: 'event'; key: string; event: InboxTimelineEvent }
  | { type: 'message'; key: string; messageId: number }

export function buildChatTimeline<T extends InboxMessageForTimeline>(
  messages: T[],
  events: InboxTimelineEvent[],
): ChatTimelineItem[] {
  const entries: Array<
    | { kind: 'message'; at: number; message: T }
    | { kind: 'event'; at: number; event: InboxTimelineEvent }
  > = [
    ...messages
      .filter((message) => message.message_type.toLowerCase() !== 'reaction')
      .map((message) => ({
        kind: 'message' as const,
        at: new Date(message.created_at).getTime(),
        message,
      })),
    ...events.map((event) => ({
      kind: 'event' as const,
      at: new Date(event.created_at).getTime(),
      event,
    })),
  ]

  entries.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at
    if (a.kind === b.kind) {
      if (a.kind === 'message' && b.kind === 'message') {
        return a.message.id - b.message.id
      }
      if (a.kind === 'event' && b.kind === 'event') {
        return a.event.id.localeCompare(b.event.id)
      }
    }
    return a.kind === 'message' ? -1 : 1
  })

  const items: ChatTimelineItem[] = []
  let lastDayKey = ''
  for (const entry of entries) {
    const day = dayKey(new Date(entry.at))
    if (day !== lastDayKey) {
      items.push({
        type: 'date',
        key: `date-${day}`,
        label: formatTimelineDateLabel(new Date(entry.at).toISOString()),
      })
      lastDayKey = day
    }
    if (entry.kind === 'message') {
      items.push({
        type: 'message',
        key: `msg-${entry.message.id}`,
        messageId: entry.message.id,
      })
    } else {
      items.push({
        type: 'event',
        key: `evt-${entry.event.id}`,
        event: entry.event,
      })
    }
  }
  return items
}
