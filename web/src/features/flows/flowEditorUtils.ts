export type FlowNodeKind =
  | 'message_text'
  | 'message_buttons'
  | 'message_image'
  | 'message_document'
  | 'handoff_human'
  | 'end'

export type FlowButton = { id: string; title: string }

export type FlowEditorNode = {
  client_key: string
  kind: FlowNodeKind
  body_text: string
  buttons: FlowButton[]
  media_url: string | null
  media_mime: string | null
  media_filename: string | null
  timeout_minutes: number | null
  timeout_body_text: string
  timeout_repeat: boolean
  timeout_max_nudges: number | null
  timeout_close_on_silence: boolean
  timeout_window_guard: boolean
  timeout_window_lead_minutes: number | null
  position_x: number
  position_y: number
  handoff_user_id: number | null
}

export type FlowEditorEdge = {
  from_client_key: string
  to_client_key: string
  match_payload: string | null
}

export type FlowNodeAnalytics = {
  client_key: string
  node_id: number | null
  label: string
  kind: string
  entered: number
  replied: number
  waiting: number
  deleted: boolean
}

export type FlowAnalytics = {
  started: number
  active: number
  completed: number
  handed_off: number
  timeout_closed: number
  nodes: FlowNodeAnalytics[]
}

export type FlowEventContactRow = {
  conversation_id: number
  contact_id: number | null
  contact_name: string
  phone: string
  event_type: string
  client_key: string | null
  node_label: string | null
  match_payload: string | null
  created_at: string
}

export type FlowDetail = {
  id: number
  name: string
  status: 'draft' | 'active' | 'paused'
  trigger_payload: string
  entry_node_id: number | null
  nodes: {
    id: number
    client_key: string
    kind: FlowNodeKind
    body_text: string
    buttons: FlowButton[]
    media_url: string | null
    media_mime: string | null
    media_filename: string | null
    timeout_minutes: number | null
    timeout_body_text: string
    timeout_repeat: boolean
    timeout_max_nudges: number | null
    timeout_close_on_silence: boolean
    timeout_window_guard: boolean
    timeout_window_lead_minutes: number | null
    sort_order: number
    position_x: number
    position_y: number
    handoff_user_id: number | null
  }[]
  edges: {
    id: number
    from_node_id: number
    to_node_id: number
    match_payload: string | null
  }[]
  metrics: {
    active_sessions: number
    completed_sessions: number
    handed_off_sessions: number
  }
  analytics: FlowAnalytics
}

let keySeq = 0
export function nextClientKey(prefix = 'n'): string {
  keySeq += 1
  return `${prefix}_${Date.now().toString(36)}_${keySeq}`
}

export function emptyNode(
  kind: FlowNodeKind = 'message_buttons',
  pos = { x: 80, y: 80 },
): FlowEditorNode {
  return {
    client_key: nextClientKey(),
    kind,
    body_text: '',
    buttons:
      kind === 'message_buttons'
        ? [{ id: 'BTN_A', title: 'Opción A' }]
        : [],
    media_url: null,
    media_mime: null,
    media_filename: null,
    timeout_minutes: null,
    timeout_body_text: '',
    timeout_repeat: false,
    timeout_max_nudges: null,
    timeout_close_on_silence: false,
    timeout_window_guard: false,
    timeout_window_lead_minutes: null,
    position_x: pos.x,
    position_y: pos.y,
    handoff_user_id: null,
  }
}

export function detailToEditor(detail: FlowDetail): {
  name: string
  trigger_payload: string
  status: FlowDetail['status']
  entry_client_key: string
  nodes: FlowEditorNode[]
  edges: FlowEditorEdge[]
} {
  const idToKey = new Map<number, string>()
  const nodes: FlowEditorNode[] = detail.nodes.map((n, i) => {
    const key = n.client_key || `n_${n.id}`
    idToKey.set(n.id, key)
    const hasPos = n.position_x !== 0 || n.position_y !== 0
    return {
      client_key: key,
      kind: n.kind,
      body_text: n.body_text,
      buttons: n.buttons.length
        ? n.buttons.map((b) => ({ id: b.id, title: b.title }))
        : [],
      media_url: n.media_url ?? null,
      media_mime: n.media_mime ?? null,
      media_filename: n.media_filename ?? null,
      timeout_minutes: n.timeout_minutes ?? null,
      timeout_body_text: n.timeout_body_text ?? '',
      timeout_repeat: Boolean(n.timeout_repeat),
      timeout_max_nudges: n.timeout_max_nudges ?? null,
      timeout_close_on_silence: Boolean(n.timeout_close_on_silence),
      timeout_window_guard: Boolean(n.timeout_window_guard),
      timeout_window_lead_minutes: n.timeout_window_lead_minutes ?? null,
      position_x: hasPos ? n.position_x : 80 + (i % 3) * 280,
      position_y: hasPos ? n.position_y : 80 + Math.floor(i / 3) * 220,
      handoff_user_id: n.handoff_user_id ?? null,
    }
  })
  const edges: FlowEditorEdge[] = detail.edges.map((e) => ({
    from_client_key: idToKey.get(e.from_node_id) || '',
    to_client_key: idToKey.get(e.to_node_id) || '',
    match_payload: e.match_payload,
  }))
  const entry =
    (detail.entry_node_id != null
      ? idToKey.get(detail.entry_node_id)
      : nodes[0]?.client_key) || nodes[0]?.client_key || ''
  return {
    name: detail.name,
    trigger_payload: detail.trigger_payload,
    status: detail.status,
    entry_client_key: entry,
    nodes,
    edges,
  }
}

export function formatTimeoutBadge(n: {
  timeout_minutes: number | null
  timeout_repeat: boolean
  timeout_max_nudges: number | null
  timeout_window_guard: boolean
}): string | null {
  if (!n.timeout_minutes && !n.timeout_window_guard) return null
  const parts: string[] = []
  if (n.timeout_minutes) {
    parts.push(
      n.timeout_minutes < 60
        ? `${n.timeout_minutes}m`
        : `${Math.round(n.timeout_minutes / 60)}h`,
    )
  }
  const max = n.timeout_repeat ? n.timeout_max_nudges || 3 : 1
  if (max > 1) parts.push(`×${max}`)
  if (n.timeout_window_guard) parts.push('24h')
  return `⏱ ${parts.join(' · ')}`
}

export const KIND_LABEL: Record<FlowNodeKind, string> = {
  message_text: 'Mensaje',
  message_buttons: 'Mensaje',
  message_image: 'Imagen',
  message_document: 'PDF',
  handoff_human: 'Derivar',
  end: 'Fin del flujo',
}

export function isMediaKind(
  kind: FlowNodeKind,
): kind is 'message_image' | 'message_document' {
  return kind === 'message_image' || kind === 'message_document'
}
