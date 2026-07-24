export type FlowNodeKind =
  | 'message_text'
  | 'message_buttons'
  | 'handoff_human'
  | 'end'

export type FlowButton = { id: string; title: string }

export type FlowEditorNode = {
  client_key: string
  kind: FlowNodeKind
  body_text: string
  buttons: FlowButton[]
}

export type FlowEditorEdge = {
  from_client_key: string
  to_client_key: string
  match_payload: string | null
}

export type FlowDetail = {
  id: number
  name: string
  status: 'draft' | 'active' | 'paused'
  trigger_payload: string
  entry_node_id: number | null
  nodes: {
    id: number
    kind: FlowNodeKind
    body_text: string
    buttons: FlowButton[]
    sort_order: number
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
}

let keySeq = 0
export function nextClientKey(prefix = 'n'): string {
  keySeq += 1
  return `${prefix}_${Date.now().toString(36)}_${keySeq}`
}

export function emptyNode(kind: FlowNodeKind = 'message_buttons'): FlowEditorNode {
  return {
    client_key: nextClientKey(),
    kind,
    body_text: '',
    buttons:
      kind === 'message_buttons'
        ? [{ id: 'BTN_A', title: 'Opción A' }]
        : [],
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
  const nodes: FlowEditorNode[] = detail.nodes.map((n) => {
    const key = nextClientKey(`n${n.id}`)
    idToKey.set(n.id, key)
    return {
      client_key: key,
      kind: n.kind,
      body_text: n.body_text,
      buttons: n.buttons.length
        ? n.buttons.map((b) => ({ id: b.id, title: b.title }))
        : [],
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

export const KIND_LABEL: Record<FlowNodeKind, string> = {
  message_text: 'Texto libre',
  message_buttons: 'Texto + botones',
  handoff_human: 'Derivar a asesor',
  end: 'Fin',
}
