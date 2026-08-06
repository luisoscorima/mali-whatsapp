import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { FlowCanvasEditor } from './FlowCanvasEditor'
import {
  detailToEditor,
  emptyNode,
  type FlowDetail,
  type FlowEditorEdge,
  type FlowEditorNode,
} from './flowEditorUtils'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'

export function FlowDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [name, setName] = useState('')
  const [triggerPayload, setTriggerPayload] = useState('')
  const [status, setStatus] = useState<'draft' | 'active' | 'paused'>('draft')
  const [entryClientKey, setEntryClientKey] = useState('')
  const [nodes, setNodes] = useState<FlowEditorNode[]>([emptyNode()])
  const [edges, setEdges] = useState<FlowEditorEdge[]>([])
  const [metricsNote, setMetricsNote] = useState('')
  const [activeSessions, setActiveSessions] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!id) return
    setReady(false)
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
      setActiveSessions(m.active_sessions)
      setMetricsNote(
        `Sesiones — activas: ${m.active_sessions} · completadas: ${m.completed_sessions} · derivadas: ${m.handed_off_sessions}`,
      )
      setLoadFailed(false)
      setCanvasKey((k) => k + 1)
      setReady(true)
    })
  }, [id])

  async function persist(graph: {
    nodes: FlowEditorNode[]
    edges: FlowEditorEdge[]
    entry: string
  }) {
    if (!id) return
    if (activeSessions > 0) {
      const ok = await confirm({
        title: 'Guardar flujo en uso',
        description: `Hay ${activeSessions} sesión(es) activa(s). Al guardar se cerrarán y el grafo nuevo aplica solo a conversaciones que disparen el flujo después.`,
        confirmLabel: 'Guardar de todos modos',
        tone: 'danger',
      })
      if (!ok) return
    }
    setSaving(true)
    setNodes(graph.nodes)
    setEdges(graph.edges)
    setEntryClientKey(graph.entry)
    const result = await apiClient.patch<FlowDetail>(`/api/flows/${id}`, {
      name: name.trim(),
      trigger_payload: triggerPayload.trim(),
      status,
      entry_client_key: graph.entry,
      nodes: graph.nodes.map((n, i) => ({
        client_key: n.client_key,
        kind: n.kind,
        body_text: n.body_text,
        buttons: n.buttons,
        timeout_minutes: n.timeout_minutes,
        timeout_body_text: n.timeout_body_text,
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
    notify.success('Flujo guardado')
    const editor = detailToEditor(result.data)
    setName(editor.name)
    setTriggerPayload(editor.trigger_payload)
    setStatus(editor.status)
    setEntryClientKey(editor.entry_client_key)
    setNodes(editor.nodes)
    setEdges(editor.edges)
    const m = result.data.metrics
    setActiveSessions(m.active_sessions)
    setMetricsNote(
      `Sesiones — activas: ${m.active_sessions} · completadas: ${m.completed_sessions} · derivadas: ${m.handed_off_sessions}`,
    )
    setCanvasKey((k) => k + 1)
  }

  async function onDelete() {
    if (!id) return
    if (
      !(await confirm({
        title: 'Eliminar flujo',
        description: '¿Eliminar este flujo?',
        confirmLabel: 'Eliminar',
        tone: 'danger',
      }))
    ) {
      return
    }
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
  if (!ready) {
    return <p className="muted p-4">Cargando…</p>
  }

  return (
    <>
      {confirmDialog}
      <FlowCanvasEditor
        key={`${id}-${canvasKey}`}
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
      submitLabel="Guardar"
      metricsNote={metricsNote}
      onDelete={onDelete}
      deleting={deleting}
    />
    </>
  )
}
