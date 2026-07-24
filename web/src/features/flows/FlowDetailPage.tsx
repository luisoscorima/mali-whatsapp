import { type FormEvent, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { FlowEditorForm } from './FlowEditorForm'
import {
  detailToEditor,
  emptyNode,
  type FlowDetail,
  type FlowEditorEdge,
  type FlowEditorNode,
} from './flowEditorUtils'

export function FlowDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [triggerPayload, setTriggerPayload] = useState('')
  const [status, setStatus] = useState<'draft' | 'active' | 'paused'>('draft')
  const [entryClientKey, setEntryClientKey] = useState('')
  const [nodes, setNodes] = useState<FlowEditorNode[]>([emptyNode()])
  const [edges, setEdges] = useState<FlowEditorEdge[]>([])
  const [metricsNote, setMetricsNote] = useState('')
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!id) return
    apiClient.get<FlowDetail>(`/api/flows/${id}`).then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        setLoadFailed(true)
        return
      }
      const editor = detailToEditor(result.data)
      setName(editor.name)
      setTriggerPayload(editor.trigger_payload)
      setStatus(editor.status)
      setEntryClientKey(editor.entry_client_key)
      setNodes(editor.nodes)
      setEdges(editor.edges)
      const m = result.data.metrics
      setMetricsNote(
        `Sesiones — activas: ${m.active_sessions} · completadas: ${m.completed_sessions} · derivadas: ${m.handed_off_sessions}`,
      )
      setLoadFailed(false)
    })
  }, [id])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!id) return
    setSaving(true)
    const result = await apiClient.patch<FlowDetail>(`/api/flows/${id}`, {
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
    notify.success('Flujo guardado')
    const editor = detailToEditor(result.data)
    setEntryClientKey(editor.entry_client_key)
    setNodes(editor.nodes)
    setEdges(editor.edges)
    const m = result.data.metrics
    setMetricsNote(
      `Sesiones — activas: ${m.active_sessions} · completadas: ${m.completed_sessions} · derivadas: ${m.handed_off_sessions}`,
    )
  }

  async function onDelete() {
    if (!id) return
    if (!window.confirm('¿Eliminar este flujo?')) return
    setDeleting(true)
    const result = await apiClient.delete<{ deleted: true }>(`/api/flows/${id}`)
    setDeleting(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success('Flujo eliminado')
    navigate('/flows')
  }

  if (loadFailed) {
    return <p className="muted p-4">No se pudo cargar el flujo.</p>
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
      submitLabel="Guardar"
      metricsNote={metricsNote}
      onDelete={onDelete}
      deleting={deleting}
    />
  )
}
