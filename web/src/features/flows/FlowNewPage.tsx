import { type FormEvent, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { FlowEditorForm } from './FlowEditorForm'
import {
  emptyNode,
  type FlowDetail,
  type FlowEditorEdge,
  type FlowEditorNode,
} from './flowEditorUtils'

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

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    const result = await apiClient.post<FlowDetail>('/api/flows', {
      name: name.trim(),
      trigger_payload: triggerPayload.trim(),
      status,
      entry_client_key: entryClientKey,
      nodes: nodes.map((n, i) => ({
        client_key: n.client_key,
        kind: n.kind,
        body_text: n.body_text,
        buttons: n.buttons,
        sort_order: i,
      })),
      edges: edges.map((ed) => ({
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
    <FlowEditorForm
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
      onSubmit={onSubmit}
      submitLabel="Crear flujo"
    />
  )
}
