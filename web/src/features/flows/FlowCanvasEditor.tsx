import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  useUpdateNodeInternals,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  MarkerType,
  ConnectionMode,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../../styles/flow-canvas.css'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/shadcn/sheet'
import { ChatPdfPreview } from '../conversations/ChatPdfPreview'
import {
  emptyNode,
  formatTimeoutBadge,
  isMediaKind,
  nextClientKey,
  type FlowEditorEdge,
  type FlowEditorNode,
  type FlowNodeKind,
} from './flowEditorUtils'

type Advisor = { id: number; label: string }

type CanvasData = {
  kind: FlowNodeKind
  body_text: string
  buttons: { id: string; title: string }[]
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
  handoff_user_id: number | null
  advisor_label?: string
  isEntry: boolean
}

type FlowCanvasEditorProps = {
  name: string
  setName: (v: string) => void
  triggerPayload: string
  setTriggerPayload: (v: string) => void
  status: 'draft' | 'active' | 'paused'
  setStatus: (v: 'draft' | 'active' | 'paused') => void
  entryClientKey: string
  setEntryClientKey: (v: string) => void
  nodes: FlowEditorNode[]
  setNodes: (nodes: FlowEditorNode[]) => void
  edges: FlowEditorEdge[]
  setEdges: (edges: FlowEditorEdge[]) => void
  saving: boolean
  onPersist: (graph: {
    nodes: FlowEditorNode[]
    edges: FlowEditorEdge[]
    entry: string
  }) => void
  submitLabel: string
  metricsNote?: string
  onDelete?: () => void
  deleting?: boolean
  /** Solo visualizar (pan/zoom); sin editar grafo ni metadatos. */
  readOnly?: boolean
}

const STATUS_LABEL: Record<'draft' | 'active' | 'paused', string> = {
  draft: 'Borrador',
  active: 'Activo',
  paused: 'Pausado',
}

const HANDLE_CLASS = 'flow-canvas-handle'

function MessageNodeView({ id, data, selected }: NodeProps<Node<CanvasData>>) {
  const updateNodeInternals = useUpdateNodeInternals()
  const buttonKey = data.buttons.map((b) => `${b.id}:${b.title}`).join('|')

  // Handles anidados: hay que refrescar bounds tras layout (si no, el hitbox queda desfasado).
  useLayoutEffect(() => {
    updateNodeInternals(id)
    const t = window.setTimeout(() => updateNodeInternals(id), 0)
    return () => window.clearTimeout(t)
  }, [id, buttonKey, data.body_text, selected, updateNodeInternals])

  return (
    <div
      className={`relative min-w-[220px] max-w-[280px] rounded-xl border bg-surface-strong p-3 shadow-sm ${
        selected ? 'border-accent' : 'border-line'
      } ${data.isEntry ? 'ring-1 ring-accent/40' : ''}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className={HANDLE_CLASS}
        isConnectable
      />
      <p className="text-xs font-medium text-muted">
        Mensaje{data.isEntry ? ' · Inicio' : ''}
      </p>
      {(() => {
        const badge = formatTimeoutBadge(data)
        return badge ? (
          <p className="mt-0.5 text-[11px] text-muted">{badge}</p>
        ) : null
      })()}
      <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap">
        {data.body_text || 'Sin texto'}
      </p>
      {data.buttons.length > 0 ? (
        <div className="mt-2 space-y-1">
          {data.buttons.map((b, i) => (
            <div
              key={`${b.id}-${i}`}
              className="relative rounded-md border border-line px-2 py-1.5 pr-3 text-xs"
            >
              <span className="font-medium">{b.title || 'Botón'}</span>
              <span className="ml-1 font-mono text-[10px] text-muted">
                {b.id}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={`btn:${b.id}`}
                className={HANDLE_CLASS}
                isConnectable
              />
            </div>
          ))}
        </div>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="next"
          className={HANDLE_CLASS}
          isConnectable
        />
      )}
      <p className="mt-2 truncate font-mono text-[10px] text-muted">{id}</p>
    </div>
  )
}

function HandoffNodeView({ id, data, selected }: NodeProps<Node<CanvasData>>) {
  return (
    <div
      className={`relative min-w-[200px] rounded-xl border bg-surface-strong p-3 shadow-sm ${
        selected ? 'border-accent' : 'border-line'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className={HANDLE_CLASS}
        isConnectable
      />
      <p className="text-xs font-medium text-muted">Derivar a asesor</p>
      <p className="mt-1 line-clamp-2 text-sm">
        {data.body_text || 'Mensaje de derivación'}
      </p>
      <p className="mt-1 text-[10px] text-muted">
        {data.handoff_user_id
          ? data.advisor_label || `Asesor #${data.handoff_user_id}`
          : 'Sin asesor fijo'}
      </p>
      <p className="mt-2 truncate font-mono text-[10px] text-muted">{id}</p>
    </div>
  )
}

function EndNodeView({ id, selected }: NodeProps<Node<CanvasData>>) {
  return (
    <div
      className={`relative min-w-[160px] rounded-xl border bg-surface-strong p-3 shadow-sm ${
        selected ? 'border-accent' : 'border-line'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className={HANDLE_CLASS}
        isConnectable
      />
      <p className="text-xs font-medium text-muted">Fin del flujo</p>
      <p className="mt-1 text-sm">Cierra sin derivar ni enviar más.</p>
      <p className="mt-2 truncate font-mono text-[10px] text-muted">{id}</p>
    </div>
  )
}

function MediaNodeView({ id, data, selected }: NodeProps<Node<CanvasData>>) {
  const isImage = data.kind === 'message_image'
  return (
    <div
      className={`relative min-w-[200px] max-w-[280px] rounded-xl border bg-surface-strong p-3 shadow-sm ${
        selected ? 'border-accent' : 'border-line'
      } ${data.isEntry ? 'ring-1 ring-accent/40' : ''}`}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="in"
        className={HANDLE_CLASS}
        isConnectable
      />
      <p className="text-xs font-medium text-muted">
        {isImage ? 'Imagen' : 'PDF'}
        {data.isEntry ? ' · Inicio' : ''}
      </p>
      {isImage && data.media_url ? (
        <img
          src={data.media_url}
          alt={data.media_filename || 'Imagen'}
          className="mt-2 max-h-28 w-full rounded-md object-cover"
        />
      ) : !isImage && data.media_url ? (
        <div className="mt-2">
          <ChatPdfPreview downloadUrl={data.media_url} />
          <p className="mt-1 truncate text-xs text-muted">
            {data.media_filename || 'PDF listo'}
          </p>
        </div>
      ) : (
        <p className="mt-2 truncate text-sm">
          {data.media_filename || (isImage ? 'Sin imagen' : 'Sin PDF')}
        </p>
      )}
      {data.body_text ? (
        <p className="mt-1 line-clamp-2 text-xs text-muted whitespace-pre-wrap">
          {data.body_text}
        </p>
      ) : null}
      <Handle
        type="source"
        position={Position.Right}
        id="next"
        className={HANDLE_CLASS}
        isConnectable
      />
      <p className="mt-2 truncate font-mono text-[10px] text-muted">{id}</p>
    </div>
  )
}

const nodeTypes = {
  message: MessageNodeView,
  image: MediaNodeView,
  document: MediaNodeView,
  handoff: HandoffNodeView,
  end: EndNodeView,
}

function toRfKind(
  kind: FlowNodeKind,
): 'message' | 'image' | 'document' | 'handoff' | 'end' {
  if (kind === 'handoff_human') return 'handoff'
  if (kind === 'end') return 'end'
  if (kind === 'message_image') return 'image'
  if (kind === 'message_document') return 'document'
  return 'message'
}

function resolveEditorKind(n: Node<CanvasData>): FlowNodeKind {
  if (n.type === 'handoff' || n.data.kind === 'handoff_human') {
    return 'handoff_human'
  }
  if (n.type === 'end' || n.data.kind === 'end') return 'end'
  if (n.type === 'image' || n.data.kind === 'message_image') {
    return 'message_image'
  }
  if (n.type === 'document' || n.data.kind === 'message_document') {
    return 'message_document'
  }
  if (n.data.buttons.length > 0) return 'message_buttons'
  return 'message_text'
}

function mapRfNodeToEditor(
  n: Node<CanvasData>,
  sortOrder: number,
): FlowEditorNode {
  const kind = resolveEditorKind(n)
  return {
    client_key: n.id,
    kind,
    body_text: n.data.body_text,
    buttons: kind === 'message_buttons' ? n.data.buttons : [],
    media_url: isMediaKind(kind) ? n.data.media_url : null,
    media_mime: isMediaKind(kind) ? n.data.media_mime : null,
    media_filename: isMediaKind(kind) ? n.data.media_filename : null,
    timeout_minutes: kind === 'message_buttons' ? n.data.timeout_minutes : null,
    timeout_body_text:
      kind === 'message_buttons' ? n.data.timeout_body_text : '',
    timeout_repeat: kind === 'message_buttons' ? n.data.timeout_repeat : false,
    timeout_max_nudges:
      kind === 'message_buttons' ? n.data.timeout_max_nudges : null,
    timeout_close_on_silence:
      kind === 'message_buttons' ? n.data.timeout_close_on_silence : false,
    timeout_window_guard:
      kind === 'message_buttons' ? n.data.timeout_window_guard : false,
    timeout_window_lead_minutes:
      kind === 'message_buttons' ? n.data.timeout_window_lead_minutes : null,
    position_x: n.position.x,
    position_y: n.position.y,
    handoff_user_id: n.data.handoff_user_id,
    sort_order: sortOrder,
  } as FlowEditorNode
}

export function FlowCanvasEditor(props: FlowCanvasEditorProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasEditorInner {...props} />
    </ReactFlowProvider>
  )
}

function FlowCanvasEditorInner({
  name,
  setName,
  triggerPayload,
  setTriggerPayload,
  status,
  setStatus,
  entryClientKey,
  setEntryClientKey,
  nodes: editorNodes,
  setNodes: setEditorNodes,
  edges: editorEdges,
  setEdges: setEditorEdges,
  saving,
  onPersist,
  submitLabel,
  metricsNote,
  onDelete,
  deleting,
  readOnly = false,
}: FlowCanvasEditorProps) {
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [mediaUploading, setMediaUploading] = useState(false)
  const [mediaUrlDraft, setMediaUrlDraft] = useState('')
  const didFitViewRef = useRef(false)
  const { fitView } = useReactFlow()

  const runFitView = useCallback(() => {
    window.requestAnimationFrame(() => {
      fitView({ padding: 0.2, duration: 200 })
    })
  }, [fitView])

  const initialRfNodes: Node<CanvasData>[] = useMemo(
    () =>
      editorNodes.map((n) => ({
        id: n.client_key,
        type: toRfKind(n.kind),
        position: { x: n.position_x, y: n.position_y },
        data: {
          kind: n.kind,
          body_text: n.body_text,
          buttons: n.buttons,
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
          handoff_user_id: n.handoff_user_id,
          isEntry: n.client_key === entryClientKey,
        },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync on mount / external reload only via key remount
    [],
  )

  const initialRfEdges: Edge[] = useMemo(
    () =>
      editorEdges
        .filter((e) => e.from_client_key && e.to_client_key)
        .map((e, i) => ({
          id: `e-${i}-${e.from_client_key}-${e.to_client_key}`,
          source: e.from_client_key,
          target: e.to_client_key,
          sourceHandle: e.match_payload ? `btn:${e.match_payload}` : 'next',
          label: e.match_payload || 'siguiente',
          markerEnd: { type: MarkerType.ArrowClosed },
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState(initialRfNodes)
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState(initialRfEdges)

  function closeInspector() {
    setSelectedId(null)
    setSelectedEdgeId(null)
    setRfNodes((nodes) =>
      nodes.map((n) => (n.selected ? { ...n, selected: false } : n)),
    )
    setRfEdges((edges) =>
      edges.map((e) => (e.selected ? { ...e, selected: false } : e)),
    )
  }

  useEffect(() => {
    if (didFitViewRef.current || rfNodes.length === 0) return
    didFitViewRef.current = true
    const t = window.setTimeout(runFitView, 50)
    return () => window.clearTimeout(t)
  }, [rfNodes.length, runFitView])

  useEffect(() => {
    apiClient.get<Advisor[]>('/api/flows/advisors').then((res) => {
      if (res.ok) setAdvisors(res.data)
    })
  }, [])

  useEffect(() => {
    if (!advisors.length) return
    setRfNodes((nodes) =>
      nodes.map((n) => {
        if (n.type !== 'handoff' || !n.data.handoff_user_id) return n
        const label =
          advisors.find((a) => a.id === n.data.handoff_user_id)?.label ||
          undefined
        if (label === n.data.advisor_label) return n
        return {
          ...n,
          data: { ...n.data, advisor_label: label },
        }
      }),
    )
  }, [advisors, setRfNodes])

  const syncOut = useCallback(
    (nextNodes: Node<CanvasData>[], nextEdges: Edge[]) => {
      const mapped: FlowEditorNode[] = nextNodes.map((n, i) =>
        mapRfNodeToEditor(n, i),
      )
      const mappedEdges: FlowEditorEdge[] = nextEdges.map((e) => {
        const handle = String(e.sourceHandle || '')
        const match = handle.startsWith('btn:')
          ? handle.slice(4)
          : handle === 'next' || !handle
            ? null
            : handle
        return {
          from_client_key: e.source,
          to_client_key: e.target,
          match_payload: match,
        }
      })
      setEditorNodes(mapped)
      setEditorEdges(mappedEdges)
    },
    [setEditorEdges, setEditorNodes],
  )

  useEffect(() => {
    setRfNodes((nodes) =>
      nodes.map((n) => {
        const isEntry = n.id === entryClientKey
        if (n.data.isEntry === isEntry) return n
        return { ...n, data: { ...n.data, isEntry } }
      }),
    )
  }, [entryClientKey, setRfNodes])

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) return

      let source = connection.source
      let target = connection.target
      let sourceHandle = connection.sourceHandle
      let targetHandle = connection.targetHandle || 'in'

      // Si se arrastró desde una entrada, RF ya intercambia ids; por si acaso normalizamos.
      const out = String(sourceHandle || '')
      const looksLikeOut =
        out.startsWith('btn:') || out === 'next' || out === ''
      if (!looksLikeOut && out === 'in') {
        source = connection.target!
        target = connection.source!
        sourceHandle = connection.targetHandle
        targetHandle = connection.sourceHandle || 'in'
      }

      setRfEdges((eds) => {
        const without = sourceHandle
          ? eds.filter(
              (e) =>
                !(e.source === source && e.sourceHandle === sourceHandle),
            )
          : eds
        const label = String(sourceHandle || '').startsWith('btn:')
          ? String(sourceHandle).slice(4)
          : 'siguiente'
        const next = addEdge(
          {
            source,
            target,
            sourceHandle,
            targetHandle,
            markerEnd: { type: MarkerType.ArrowClosed },
            label,
          },
          without,
        )
        syncOut(rfNodes, next)
        return next
      })
    },
    [rfNodes, setRfEdges, syncOut],
  )

  function pushNodes(next: Node<CanvasData>[]) {
    setRfNodes(next)
    syncOut(next, rfEdges)
  }

  function addCanvasNode(kind: FlowNodeKind) {
    const key = nextClientKey()
    const count = rfNodes.length
    const blank = emptyNode(kind, {
      x: 80 + (count % 3) * 280,
      y: 80 + Math.floor(count / 3) * 220,
    })
    const node: Node<CanvasData> = {
      id: key,
      type: toRfKind(kind),
      position: { x: blank.position_x, y: blank.position_y },
      data: {
        kind,
        body_text: blank.body_text,
        buttons: blank.buttons,
        media_url: blank.media_url,
        media_mime: blank.media_mime,
        media_filename: blank.media_filename,
        timeout_minutes: blank.timeout_minutes,
        timeout_body_text: blank.timeout_body_text,
        timeout_repeat: blank.timeout_repeat,
        timeout_max_nudges: blank.timeout_max_nudges,
        timeout_close_on_silence: blank.timeout_close_on_silence,
        timeout_window_guard: blank.timeout_window_guard,
        timeout_window_lead_minutes: blank.timeout_window_lead_minutes,
        handoff_user_id: null,
        isEntry: rfNodes.length === 0,
      },
    }
    const next = [...rfNodes, node]
    if (rfNodes.length === 0) setEntryClientKey(key)
    pushNodes(next)
    setSelectedId(key)
  }

  function updateSelected(patch: Partial<CanvasData>) {
    if (!selectedId) return
    const selectedNode = rfNodes.find((n) => n.id === selectedId)
    const next = rfNodes.map((n) => {
      if (n.id !== selectedId) return n
      const data = { ...n.data, ...patch }
      if (
        patch.buttons &&
        (n.data.kind === 'message_text' || n.data.kind === 'message_buttons')
      ) {
        const kind =
          patch.buttons.length > 0 ? 'message_buttons' : 'message_text'
        data.kind = kind as FlowNodeKind
      }
      return { ...n, data }
    })
    let nextEdges = rfEdges
    if (
      patch.buttons &&
      selectedNode &&
      (selectedNode.data.kind === 'message_text' ||
        selectedNode.data.kind === 'message_buttons')
    ) {
      const oldButtons = selectedNode.data.buttons
      nextEdges = rfEdges
        .map((e) => {
          if (e.source !== selectedId) return e
          const handle = String(e.sourceHandle || '')
          if (!handle.startsWith('btn:')) {
            return patch.buttons!.length === 0 ? e : e
          }
          const oldId = handle.slice(4)
          const idx = oldButtons.findIndex((b) => b.id === oldId)
          if (idx < 0) return null
          const nextBtn = patch.buttons![idx]
          if (!nextBtn) return null
          if (nextBtn.id === oldId) return e
          return {
            ...e,
            sourceHandle: `btn:${nextBtn.id}`,
            label: nextBtn.id,
          }
        })
        .filter((e): e is Edge => e != null)
      // Mensaje sin botones: handles "next"; con botones: quitar "next" huérfanos
      if (patch.buttons.length === 0) {
        nextEdges = nextEdges.map((e) =>
          e.source === selectedId && e.sourceHandle?.startsWith('btn:')
            ? { ...e, sourceHandle: 'next', label: 'siguiente' }
            : e,
        )
      } else {
        nextEdges = nextEdges.map((e) =>
          e.source === selectedId &&
          (e.sourceHandle === 'next' || !e.sourceHandle)
            ? {
                ...e,
                sourceHandle: `btn:${patch.buttons![0]!.id}`,
                label: patch.buttons![0]!.id,
              }
            : e,
        )
      }
      setRfEdges(nextEdges)
    }
    setRfNodes(next)
    syncOut(next, nextEdges)
  }

  function removeSelected() {
    if (!selectedId || rfNodes.length <= 1) return
    const nextNodes = rfNodes.filter((n) => n.id !== selectedId)
    const nextEdges = rfEdges.filter(
      (e) => e.source !== selectedId && e.target !== selectedId,
    )
    setRfNodes(nextNodes)
    setRfEdges(nextEdges)
    syncOut(nextNodes, nextEdges)
    if (entryClientKey === selectedId) {
      setEntryClientKey(nextNodes[0]?.id || '')
    }
    setSelectedId(null)
  }

  function removeSelectedEdge() {
    if (!selectedEdgeId) return
    const nextEdges = rfEdges.filter((e) => e.id !== selectedEdgeId)
    setRfEdges(nextEdges)
    syncOut(rfNodes, nextEdges)
    setSelectedEdgeId(null)
  }

  const selected = rfNodes.find((n) => n.id === selectedId)
  const selectedEdge = rfEdges.find((e) => e.id === selectedEdgeId)

  useEffect(() => {
    if (selected && isMediaKind(selected.data.kind)) {
      setMediaUrlDraft(selected.data.media_url || '')
    } else {
      setMediaUrlDraft('')
    }
  }, [selectedId, selected?.data.kind, selected?.data.media_url])

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault()
    if (readOnly) return
    const mapped: FlowEditorNode[] = rfNodes.map((n, i) =>
      mapRfNodeToEditor(n, i),
    )
    for (const n of mapped) {
      if (isMediaKind(n.kind) && !String(n.media_url || '').trim()) {
        notify.error(
          n.kind === 'message_image'
            ? 'Hay un nodo de imagen sin archivo.'
            : 'Hay un nodo de PDF sin archivo.',
        )
        return
      }
    }
    const keyCounts = new Map<string, number>()
    for (const n of mapped) {
      for (const b of n.buttons) {
        const id = String(b.id || '').trim()
        if (!id) continue
        keyCounts.set(id, (keyCounts.get(id) || 0) + 1)
      }
    }
    const dupes = [...keyCounts.entries()]
      .filter(([, c]) => c > 1)
      .map(([id]) => id)
    if (dupes.length) {
      notify.error(
        `Keys de botón duplicadas: ${dupes.join(', ')}. Cada key debe ser única en el flujo.`,
      )
      return
    }
    const mappedEdges: FlowEditorEdge[] = rfEdges.map((ed) => {
      const handle = String(ed.sourceHandle || '')
      const match = handle.startsWith('btn:') ? handle.slice(4) : null
      return {
        from_client_key: ed.source,
        to_client_key: ed.target,
        match_payload: match,
      }
    })
    const entry =
      entryClientKey && mapped.some((n) => n.client_key === entryClientKey)
        ? entryClientKey
        : mapped[0]?.client_key || ''
    onPersist({ nodes: mapped, edges: mappedEdges, entry })
  }

  async function uploadSelectedMedia(file: File) {
    if (!selected || !isMediaKind(selected.data.kind)) return
    const form = new FormData()
    form.append('file', file)
    form.append(
      'kind',
      selected.data.kind === 'message_image' ? 'image' : 'document',
    )
    setMediaUploading(true)
    const result = await apiClient.postFormData<{
      url: string
      mime: string
      filename: string
      wa_type: 'image' | 'document'
    }>('/api/flows/media', form)
    setMediaUploading(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    updateSelected({
      media_url: result.data.url,
      media_mime: result.data.mime,
      media_filename: result.data.filename,
    })
    setMediaUrlDraft(result.data.url)
    notify.success(
      selected.data.kind === 'message_image' ? 'Imagen subida' : 'PDF subido',
    )
  }

  function applyMediaUrl() {
    if (!selected || !isMediaKind(selected.data.kind)) return
    const url = mediaUrlDraft.trim()
    if (!url) {
      notify.error('Pega una URL HTTPS')
      return
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      notify.error('URL inválida')
      return
    }
    if (parsed.protocol !== 'https:') {
      notify.error('La URL debe ser HTTPS (WhatsApp no acepta http)')
      return
    }
    const pathName = decodeURIComponent(parsed.pathname.split('/').pop() || '')
    const filename =
      pathName.replace(/[^\w.\- ()áéíóúñÁÉÍÓÚÑ]+/g, '_').slice(0, 180) ||
      (selected.data.kind === 'message_image' ? 'imagen.jpg' : 'archivo.pdf')
    const lower = filename.toLowerCase()
    let mime =
      selected.data.kind === 'message_image' ? 'image/jpeg' : 'application/pdf'
    if (lower.endsWith('.png')) mime = 'image/png'
    else if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg'
    else if (lower.endsWith('.pdf')) mime = 'application/pdf'
    if (selected.data.kind === 'message_image' && mime === 'application/pdf') {
      notify.error('Para imagen usa una URL de JPEG/PNG')
      return
    }
    if (selected.data.kind === 'message_document' && mime.startsWith('image/')) {
      notify.error('Para PDF usa una URL de PDF')
      return
    }
    updateSelected({
      media_url: url,
      media_mime: mime,
      media_filename: filename,
    })
    notify.success('URL aplicada')
  }

  function clearMedia() {
    if (!selected || !isMediaKind(selected.data.kind)) return
    updateSelected({
      media_url: null,
      media_mime: null,
      media_filename: null,
    })
    setMediaUrlDraft('')
  }

  return (
    <form className="flex flex-col gap-3 p-3 md:p-4" onSubmit={handleFormSubmit}>
      {readOnly ? (
        <div>
          <h1 className="text-lg font-semibold">{name || 'Sin nombre'}</h1>
          <p className="mt-1 text-sm text-muted">
            <span className="font-mono">{triggerPayload}</span>
            {' · '}
            {STATUS_LABEL[status]}
          </p>
          <p className="mt-2 text-xs text-muted">
            Vista móvil: puedes mover y acercar el diagrama. Edita desde escritorio.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">
              <span className="text-muted">Nombre</span>
              <input
                className="mt-1 block w-56 rounded-lg border border-line bg-surface-strong px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={150}
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Trigger key</span>
              <input
                className="mt-1 block w-56 rounded-lg border border-line bg-surface-strong px-3 py-2 font-mono text-sm"
                value={triggerPayload}
                onChange={(e) => setTriggerPayload(e.target.value)}
                required
                maxLength={256}
                placeholder="INICIAR_FLUJO"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Estado</span>
              <select
                className="mt-1 block rounded-lg border border-line bg-surface-strong px-3 py-2"
                value={status}
                onChange={(e) =>
                  setStatus(e.target.value as 'draft' | 'active' | 'paused')
                }
              >
                <option value="draft">Borrador</option>
                <option value="active">Activo</option>
                <option value="paused">Pausado</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="small-btn"
              onClick={() => addCanvasNode('message_buttons')}
            >
              + Mensaje
            </button>
            <button
              type="button"
              className="small-btn"
              onClick={() => addCanvasNode('message_image')}
            >
              + Imagen
            </button>
            <button
              type="button"
              className="small-btn"
              onClick={() => addCanvasNode('message_document')}
            >
              + PDF
            </button>
            <button
              type="button"
              className="small-btn"
              onClick={() => addCanvasNode('handoff_human')}
            >
              + Derivar
            </button>
            <button
              type="button"
              className="small-btn"
              onClick={() => addCanvasNode('end')}
            >
              + Fin
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
              disabled={saving}
            >
              {saving ? 'Guardando…' : submitLabel}
            </button>
            {onDelete ? (
              <button
                type="button"
                className="rounded-lg border border-bad px-4 py-2 text-sm text-bad disabled:opacity-60"
                disabled={deleting}
                onClick={onDelete}
              >
                {deleting ? 'Eliminando…' : 'Eliminar'}
              </button>
            ) : null}
          </div>
        </div>
      )}
      {metricsNote ? (
        <p className="muted campaign-drilldown-dialog__note text-sm">{metricsNote}</p>
      ) : null}
      {readOnly ? null : (
        <p className="text-xs text-muted">
          Arrastra nodos y conecta desde el punto de cada botón (key). Doble
          clic en un nodo o conector para editarlo. Imagen/PDF se envían y
          continúan solos. Cada key de botón debe ser única. Solo cuenta el
          último mensaje del asistente.
        </p>
      )}

      <div
        className={`flow-canvas overflow-hidden rounded-xl border border-line bg-surface ${
          readOnly
            ? 'h-[min(45vh,420px)] min-h-[260px]'
            : 'h-[min(60vh,640px)] min-h-[420px]'
        }`}
      >
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          onNodesChange={readOnly ? undefined : onNodesChange}
          onEdgesChange={
            readOnly
              ? undefined
              : (chs) => {
                  onEdgesChange(chs)
                  if (chs.some((c) => c.type === 'remove')) {
                    setSelectedEdgeId(null)
                  }
                }
          }
          onEdgesDelete={
            readOnly
              ? undefined
              : (deleted) => {
                  const deletedIds = new Set(deleted.map((e) => e.id))
                  const nextEdges = rfEdges.filter((e) => !deletedIds.has(e.id))
                  syncOut(rfNodes, nextEdges)
                  setSelectedEdgeId(null)
                }
          }
          onNodeDragStop={
            readOnly
              ? undefined
              : (_e, _node, nodes) => {
                  syncOut(nodes as Node<CanvasData>[], rfEdges)
                }
          }
          onConnect={readOnly ? undefined : onConnect}
          onNodeDoubleClick={
            readOnly
              ? undefined
              : (_e, node) => {
                  setSelectedEdgeId(null)
                  setSelectedId(node.id)
                }
          }
          onEdgeDoubleClick={
            readOnly
              ? undefined
              : (_e, edge) => {
                  setSelectedId(null)
                  setSelectedEdgeId(edge.id)
                }
          }
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          onInit={() => runFitView()}
          snapToGrid={!readOnly}
          snapGrid={[16, 16]}
          connectionMode={ConnectionMode.Loose}
          connectionRadius={40}
          nodesDraggable={!readOnly}
          nodesConnectable={!readOnly}
          nodesFocusable={!readOnly}
          edgesFocusable={!readOnly}
          edgesReconnectable={!readOnly}
          elementsSelectable={!readOnly}
          panOnDrag
          zoomOnScroll
          zoomOnPinch
          deleteKeyCode={readOnly ? null : ['Backspace', 'Delete']}
          multiSelectionKeyCode={null}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{
            markerEnd: { type: MarkerType.ArrowClosed },
            interactionWidth: 28,
          }}
        >
          <Background color="var(--line)" gap={16} />
          <Controls showInteractive={false} />
          {readOnly ? null : (
            <MiniMap
              pannable
              zoomable={false}
              nodeStrokeWidth={0}
              maskColor="color-mix(in srgb, var(--ink) 18%, transparent)"
            />
          )}
        </ReactFlow>
      </div>

      <Sheet
        open={!readOnly && Boolean(selected || selectedEdge)}
        onOpenChange={(open) => {
          if (!open) closeInspector()
        }}
      >
        <SheetContent
          side="right"
          className="w-[min(100%,28rem)]"
          onPointerDownOutside={(e) => {
            // Evita que el click en el overlay re-seleccione el canvas debajo.
            e.preventDefault()
            closeInspector()
          }}
          onInteractOutside={(e) => {
            e.preventDefault()
            closeInspector()
          }}
          onEscapeKeyDown={(e) => {
            e.preventDefault()
            closeInspector()
          }}
        >
          <SheetHeader>
            <SheetTitle>
              {selectedEdge && !selected
                ? 'Conexión'
                : selected?.type === 'handoff'
                  ? 'Derivar'
                  : selected?.type === 'end'
                    ? 'Fin'
                    : selected?.type === 'image'
                      ? 'Imagen'
                      : selected?.type === 'document'
                        ? 'PDF'
                        : 'Mensaje'}
            </SheetTitle>
            <SheetDescription>
              {selectedEdge && !selected
                ? 'Edita o quita esta conexión del flujo.'
                : 'Los cambios se aplican al instante; usa Guardar para persistir el flujo.'}
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-3">
            {selectedEdge && !selected ? (
              <>
                <p className="text-xs text-muted">
                  {String(selectedEdge.label || 'siguiente')} → destino
                </p>
                <button
                  type="button"
                  className="rounded-lg border border-bad px-3 py-1.5 text-sm text-bad"
                  onClick={removeSelectedEdge}
                >
                  Quitar conexión
                </button>
              </>
            ) : selected ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="flow-entry-node"
                    checked={entryClientKey === selected.id}
                    onChange={() => setEntryClientKey(selected.id)}
                  />
                  Nodo inicial
                  {entryClientKey === selected.id ? (
                    <span className="text-xs text-muted">(único)</span>
                  ) : null}
                </label>
                {selected.type !== 'end' ? (
                  <label className="block text-sm">
                    <span className="text-muted">
                      {isMediaKind(selected.data.kind)
                        ? 'Pie / caption (opcional)'
                        : 'Texto'}
                    </span>
                    <textarea
                      className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                      rows={isMediaKind(selected.data.kind) ? 2 : 4}
                      value={selected.data.body_text}
                      onChange={(e) =>
                        updateSelected({ body_text: e.target.value })
                      }
                    />
                  </label>
                ) : (
                  <p className="text-xs text-muted">
                    Termina la sesión del flujo sin enviar ni derivar.
                  </p>
                )}
                {isMediaKind(selected.data.kind) ? (
                  <div className="space-y-2 rounded-lg border border-line p-2">
                    {selected.data.kind === 'message_image' &&
                    selected.data.media_url ? (
                      <img
                        src={selected.data.media_url}
                        alt={selected.data.media_filename || 'Preview'}
                        className="max-h-40 w-full rounded-md object-contain"
                      />
                    ) : null}
                    {selected.data.kind === 'message_document' &&
                    selected.data.media_url ? (
                      <ChatPdfPreview downloadUrl={selected.data.media_url} />
                    ) : null}
                    <p className="truncate text-xs text-muted">
                      {selected.data.media_filename ||
                        (selected.data.media_url
                          ? selected.data.kind === 'message_image'
                            ? 'Imagen lista'
                            : 'PDF listo'
                          : selected.data.kind === 'message_image'
                            ? 'Sin imagen ni URL'
                            : 'Sin PDF ni URL')}
                    </p>
                    <label className="small-btn inline-flex cursor-pointer">
                      {mediaUploading
                        ? 'Subiendo…'
                        : selected.data.media_url
                          ? selected.data.kind === 'message_image'
                            ? 'Cambiar imagen'
                            : 'Cambiar PDF'
                          : selected.data.kind === 'message_image'
                            ? 'Subir imagen'
                            : 'Subir PDF'}
                      <input
                        type="file"
                        className="hidden"
                        accept={
                          selected.data.kind === 'message_image'
                            ? 'image/jpeg,image/png,image/jpg'
                            : 'application/pdf'
                        }
                        disabled={mediaUploading}
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          e.target.value = ''
                          if (file) void uploadSelectedMedia(file)
                        }}
                      />
                    </label>
                    <div className="space-y-1">
                      <p className="text-xs text-muted">O pegar URL HTTPS</p>
                      <input
                        className="w-full rounded border border-line bg-surface px-2 py-1 font-mono text-xs"
                        placeholder="https://…"
                        value={mediaUrlDraft}
                        onChange={(e) => setMediaUrlDraft(e.target.value)}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="small-btn"
                          onClick={applyMediaUrl}
                        >
                          Usar URL
                        </button>
                        {selected.data.media_url ? (
                          <button
                            type="button"
                            className="rounded border border-bad px-2 py-0.5 text-xs text-bad"
                            onClick={clearMedia}
                          >
                            {selected.data.kind === 'message_image'
                              ? 'Quitar imagen'
                              : 'Quitar PDF'}
                          </button>
                        ) : null}
                      </div>
                    </div>
                    <p className="text-[11px] text-muted">
                      {selected.data.kind === 'message_image'
                        ? 'JPEG/PNG por archivo o URL pública HTTPS. Se envía y sigue al siguiente nodo.'
                        : 'PDF por archivo o URL pública HTTPS. Se envía y sigue al siguiente nodo.'}
                    </p>
                  </div>
                ) : null}
                {selected.type === 'message' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted">
                      Botones (título + key, máx. 3)
                    </p>
                    {selected.data.buttons.map((b, idx) => (
                      <div
                        key={idx}
                        className="space-y-1 rounded-lg border border-line p-2"
                      >
                        <input
                          className="w-full rounded border border-line bg-surface px-2 py-1 text-sm"
                          placeholder="Título"
                          maxLength={20}
                          value={b.title}
                          onChange={(e) => {
                            const buttons = selected.data.buttons.map((x, i) =>
                              i === idx ? { ...x, title: e.target.value } : x,
                            )
                            updateSelected({ buttons })
                          }}
                        />
                        <input
                          className="w-full rounded border border-line bg-surface px-2 py-1 font-mono text-xs"
                          placeholder="key"
                          maxLength={256}
                          value={b.id}
                          onChange={(e) => {
                            const buttons = selected.data.buttons.map((x, i) =>
                              i === idx ? { ...x, id: e.target.value } : x,
                            )
                            updateSelected({ buttons })
                          }}
                        />
                        <button
                          type="button"
                          className="rounded border border-bad px-2 py-0.5 text-xs text-bad"
                          onClick={() =>
                            updateSelected({
                              buttons: selected.data.buttons.filter(
                                (_, i) => i !== idx,
                              ),
                            })
                          }
                        >
                          Quitar
                        </button>
                      </div>
                    ))}
                    {selected.data.buttons.length < 3 ? (
                      <button
                        type="button"
                        className="small-btn"
                        onClick={() =>
                          updateSelected({
                            buttons: [
                              ...selected.data.buttons,
                              {
                                id: `BTN_${selected.data.buttons.length + 1}`,
                                title: `Opción ${selected.data.buttons.length + 1}`,
                              },
                            ],
                          })
                        }
                      >
                        + Botón
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {selected.type === 'message' &&
                selected.data.buttons.length > 0 ? (
                  <div className="space-y-2 rounded-lg border border-line p-2">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.data.timeout_minutes != null}
                        onChange={(e) =>
                          updateSelected({
                            timeout_minutes: e.target.checked ? 15 : null,
                            timeout_body_text: e.target.checked
                              ? selected.data.timeout_body_text ||
                                '¿Sigues ahí? Pulsa Continuar para seguir con el flujo.'
                              : selected.data.timeout_window_guard
                                ? selected.data.timeout_body_text
                                : '',
                            timeout_repeat: e.target.checked
                              ? selected.data.timeout_repeat
                              : false,
                            timeout_max_nudges: e.target.checked
                              ? selected.data.timeout_max_nudges
                              : null,
                          })
                        }
                      />
                      Recordatorio si no responde
                    </label>
                    {selected.data.timeout_minutes != null ? (
                      <>
                        <label className="block text-sm">
                          <span className="text-muted">Minutos</span>
                          <input
                            type="number"
                            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                            min={1}
                            max={1440}
                            value={selected.data.timeout_minutes}
                            onChange={(e) => {
                              const raw = e.target.value.trim()
                              updateSelected({
                                timeout_minutes: raw ? Number(raw) : null,
                              })
                            }}
                          />
                        </label>
                        <label className="block text-sm">
                          <span className="text-muted">
                            Mensaje de confirmación
                          </span>
                          <textarea
                            className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                            rows={3}
                            value={selected.data.timeout_body_text}
                            onChange={(e) =>
                              updateSelected({
                                timeout_body_text: e.target.value,
                              })
                            }
                          />
                        </label>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected.data.timeout_repeat}
                            onChange={(e) =>
                              updateSelected({
                                timeout_repeat: e.target.checked,
                                timeout_max_nudges: e.target.checked
                                  ? selected.data.timeout_max_nudges || 3
                                  : null,
                              })
                            }
                          />
                          Repetir recordatorio
                        </label>
                        {selected.data.timeout_repeat ? (
                          <label className="block text-sm">
                            <span className="text-muted">Veces (máx. 5)</span>
                            <input
                              type="number"
                              className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                              min={1}
                              max={5}
                              value={selected.data.timeout_max_nudges ?? 3}
                              onChange={(e) =>
                                updateSelected({
                                  timeout_max_nudges:
                                    Number(e.target.value) || 3,
                                })
                              }
                            />
                          </label>
                        ) : null}
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={selected.data.timeout_close_on_silence}
                            onChange={(e) =>
                              updateSelected({
                                timeout_close_on_silence: e.target.checked,
                              })
                            }
                          />
                          Cerrar flujo si sigue sin responder
                        </label>
                      </>
                    ) : null}
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selected.data.timeout_window_guard}
                        onChange={(e) =>
                          updateSelected({
                            timeout_window_guard: e.target.checked,
                            timeout_window_lead_minutes: e.target.checked
                              ? selected.data.timeout_window_lead_minutes || 60
                              : null,
                            timeout_body_text: e.target.checked
                              ? selected.data.timeout_body_text ||
                                '¿Sigues ahí? Pulsa Continuar para seguir con el flujo.'
                              : selected.data.timeout_minutes
                                ? selected.data.timeout_body_text
                                : '',
                          })
                        }
                      />
                      Avisar antes de cerrar ventana 24h
                    </label>
                    {selected.data.timeout_window_guard ? (
                      <label className="block text-sm">
                        <span className="text-muted">
                          Minutos antes del cierre
                        </span>
                        <input
                          type="number"
                          className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                          min={1}
                          max={1440}
                          value={
                            selected.data.timeout_window_lead_minutes ?? 60
                          }
                          onChange={(e) =>
                            updateSelected({
                              timeout_window_lead_minutes:
                                Number(e.target.value) || 60,
                            })
                          }
                        />
                      </label>
                    ) : null}
                    {(selected.data.timeout_minutes != null ||
                      selected.data.timeout_window_guard) && (
                      <p className="muted text-xs">
                        Provoca una respuesta para mantener la ventana de 24h;
                        un mensaje solo del bot no la renueva.
                      </p>
                    )}
                  </div>
                ) : null}
                {selected.type === 'handoff' ? (
                  <label className="block text-sm">
                    <span className="text-muted">Asesor</span>
                    <select
                      className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5"
                      value={selected.data.handoff_user_id ?? ''}
                      onChange={(e) =>
                        updateSelected({
                          handoff_user_id: e.target.value
                            ? Number(e.target.value)
                            : null,
                          advisor_label: e.target.value
                            ? advisors.find(
                                (a) => a.id === Number(e.target.value),
                              )?.label
                            : undefined,
                        })
                      }
                    >
                      <option value="">Sin asignar (solo modo asesor)</option>
                      {advisors.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button
                  type="button"
                  className="rounded-lg border border-bad px-3 py-1.5 text-sm text-bad disabled:opacity-40"
                  disabled={rfNodes.length <= 1}
                  onClick={removeSelected}
                >
                  Eliminar nodo
                </button>
              </>
            ) : null}
          </SheetBody>
          <SheetFooter>
            <SheetClose type="button" onClick={closeInspector}>
              Cerrar
            </SheetClose>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </form>
  )
}