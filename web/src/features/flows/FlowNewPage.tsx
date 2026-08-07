import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { FlowCanvasEditor } from './FlowCanvasEditor'
import {
  emptyNode,
  type FlowDetail,
  type FlowEditorEdge,
  type FlowEditorNode,
} from './flowEditorUtils'
import { useUnsavedChangesGuard } from '@/shared/hooks/useUnsavedChangesGuard'

export function FlowNewPage() {
  const navigate = useNavigate()
  const first = emptyNode('message_buttons')
  const [name, setName] = useState('')
  const [triggerPayload, setTriggerPayload] = useState('INICIAR_FLUJO')
  const [status, setStatus] = useState<'draft' | 'active' | 'paused'>('draft')
  const [entryClientKey, setEntryClientKey] = useState(first.client_key)
  const [nodes, setNodes] = useState<FlowEditorNode[]>([first])
  const [edges, setEdges] = useState<FlowEditorEdge[]>([])
  const [saving, setSaving] = useState(false)

  const dirty = useMemo(() => {
    if (name.trim()) return true
    if (triggerPayload.trim() !== 'INICIAR_FLUJO') return true
    if (status !== 'draft') return true
    if (nodes.length !== 1) return true
    if (edges.length > 0) return true
    const only = nodes[0]
    return (
      Boolean(only?.body_text?.trim()) ||
      (only?.buttons?.length ?? 0) > 0 ||
      Boolean(only?.media_url)
    )
  }, [name, triggerPayload, status, nodes, edges])

  useUnsavedChangesGuard(dirty && !saving)

  async function persist(graph: {
    nodes: FlowEditorNode[]
    edges: FlowEditorEdge[]
    entry: string
  }) {
    setSaving(true)
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setEntryClientKey(graph.entry)
    const result = await apiClient.post<FlowDetail>('/api/flows', {
      name: name.trim(),
      trigger_payload: triggerPayload.trim(),
      status,
      entry_client_key: graph.entry,
      nodes: graph.nodes.map((n, i) => ({
        client_key: n.client_key,
        kind: n.kind,
        body_text: n.body_text,
        buttons: n.buttons,
        media_url: n.media_url,
        media_mime: n.media_mime,
        media_filename: n.media_filename,
        timeout_minutes: n.timeout_minutes,
        timeout_body_text: n.timeout_body_text,
        timeout_repeat: n.timeout_repeat,
        timeout_max_nudges: n.timeout_max_nudges,
        timeout_close_on_silence: n.timeout_close_on_silence,
        timeout_window_guard: n.timeout_window_guard,
        timeout_window_lead_minutes: n.timeout_window_lead_minutes,
        sort_order: i,
        position_x: n.position_x,
        position_y: n.position_y,
        handoff_user_id: n.handoff_user_id,
      })),
      edges: graph.edges.map((ed) => ({
        from_client_key: ed.from_client_key,
        to_client_key: ed.to_client_key,
        match_payload: ed.match_payload,
      })),
    })
    setSaving(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success('Flujo creado')
    navigate(`/flows/${result.data.id}`)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="px-3 pt-3 md:px-4 md:pt-4">
        <Link to="/flows" className="inbox-back-mobile">
          ← Flujos
        </Link>
        <Link
          to="/flows"
          className="text-sm text-accent hover:underline max-md:hidden"
        >
          ← Flujos
        </Link>
      </div>
      <FlowCanvasEditor
        name={name}
        setName={setName}
        triggerPayload={triggerPayload}
        setTriggerPayload={setTriggerPayload}
        status={status}
        setStatus={setStatus}
        entryClientKey={entryClientKey}
        setEntryClientKey={setEntryClientKey}
        nodes={nodes}
        setNodes={setNodes}
        edges={edges}
        setEdges={setEdges}
        saving={saving}
        onPersist={persist}
        submitLabel="Crear flujo"
      />
    </div>
  )
}
