import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { FlowCanvasEditor } from './FlowCanvasEditor'
import { FlowAnalyticsPanel } from './FlowAnalyticsPanel'
import {
  FlowDrilldownDialog,
  type FlowDrilldownQuery,
} from './FlowDrilldownDialog'
import {
  detailToEditor,
  emptyNode,
  type FlowAnalytics,
  type FlowDetail,
  type FlowEditorEdge,
  type FlowEditorNode,
} from './flowEditorUtils'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'

const EMPTY_ANALYTICS: FlowAnalytics = {
  started: 0,
  active: 0,
  completed: 0,
  handed_off: 0,
  timeout_closed: 0,
  nodes: [],
}

function useIsMobileViewport(breakpointPx = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia(`(max-width: ${breakpointPx}px)`).matches
      : false,
  )
  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpointPx}px)`)
    const onChange = () => setIsMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [breakpointPx])
  return isMobile
}

export function FlowDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { confirm, confirmDialog } = useConfirmDialog()
  const isMobile = useIsMobileViewport()
  const [name, setName] = useState('')
  const [triggerPayload, setTriggerPayload] = useState('')
  const [status, setStatus] = useState<'draft' | 'active' | 'paused'>('draft')
  const [entryClientKey, setEntryClientKey] = useState('')
  const [nodes, setNodes] = useState<FlowEditorNode[]>([emptyNode()])
  const [edges, setEdges] = useState<FlowEditorEdge[]>([])
  const [analytics, setAnalytics] = useState<FlowAnalytics>(EMPTY_ANALYTICS)
  const [activeSessions, setActiveSessions] = useState(0)
  const [loadFailed, setLoadFailed] = useState(false)
  const [ready, setReady] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [drilldownOpen, setDrilldownOpen] = useState(false)
  const [drilldownQuery, setDrilldownQuery] = useState<FlowDrilldownQuery | null>(
    null,
  )

  function applyDetail(detail: FlowDetail) {
    const editor = detailToEditor(detail)
    setName(editor.name)
    setTriggerPayload(editor.trigger_payload)
    setStatus(editor.status)
    setEntryClientKey(editor.entry_client_key)
    setNodes(editor.nodes)
    setEdges(editor.edges)
    setActiveSessions(detail.metrics.active_sessions)
    setAnalytics(detail.analytics || EMPTY_ANALYTICS)
  }

  useEffect(() => {
    if (!id) return
    setReady(false)
    apiClient.get<FlowDetail>(`/api/flows/${id}`).then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        setLoadFailed(true)
        return
      }
      applyDetail(result.data)
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
    notify.success('Flujo guardado')
    applyDetail(result.data)
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
    return (
      <div className="space-y-3 p-4">
        <Link to="/flows" className="inbox-back-mobile">
          ← Flujos
        </Link>
        <Link
          to="/flows"
          className="text-sm text-accent hover:underline max-md:hidden"
        >
          ← Flujos
        </Link>
        <p className="muted">No se pudo cargar el flujo.</p>
      </div>
    )
  }
  if (!ready) {
    return <p className="muted p-4">Cargando…</p>
  }

  const flowId = Number(id)

  return (
    <div className="flex flex-col gap-4">
      {confirmDialog}
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
        onDelete={isMobile ? undefined : onDelete}
        deleting={deleting}
        readOnly={isMobile}
      />
      <div className="relative z-10 space-y-3 border-t border-line bg-[var(--wa-chat-bg,var(--surface))] px-3 pb-4 pt-4 md:px-4">
        <h2 className="text-sm font-medium text-muted">Historial del flujo</h2>
        <FlowAnalyticsPanel
          analytics={analytics}
          onOpenDrilldown={(q) => {
            setDrilldownQuery(q)
            setDrilldownOpen(true)
          }}
        />
      </div>
      <FlowDrilldownDialog
        open={drilldownOpen}
        onOpenChange={setDrilldownOpen}
        flowId={flowId}
        query={drilldownQuery}
      />
    </div>
  )
}
