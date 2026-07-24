import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
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
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
  MarkerType,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import {
  emptyNode,
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
}

function MessageNodeView({ id, data, selected }: NodeProps<Node<CanvasData>>) {
  // Handles a nivel de nodo (no anidados): si van dentro de cada fila con top %,
  // React Flow los mide respecto al nodo completo y se apilan → el hilo no engancha.
  const buttonHandleBottom = (index: number) => {
    const fromBottom = data.buttons.length - 1 - index
    // id mono (~22px) + padding + centro de fila (~34px)
    return 22 + fromBottom * 34 + 14
  }

  return (
    <div
      className={`relative min-w-[220px] max-w-[260px] rounded-xl border bg-surface-strong p-3 shadow-sm ${
        selected ? 'border-accent' : 'border-line'
      } ${data.isEntry ? 'ring-1 ring-accent/40' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent" />
      <p className="text-xs font-medium text-muted">
        Mensaje{data.isEntry ? ' · Inicio' : ''}
      </p>
      <p className="mt-1 line-clamp-3 text-sm whitespace-pre-wrap">
        {data.body_text || 'Sin texto'}
      </p>
      {data.buttons.length > 0 ? (
        <>
          <div className="mt-2 space-y-1">
            {data.buttons.map((b, i) => (
              <div
                key={`${b.id}-${i}`}
                className="rounded-md border border-line px-2 py-1.5 text-xs"
              >
                <span className="font-medium">{b.title || 'Botón'}</span>
                <span className="ml-1 font-mono text-[10px] text-muted">
                  {b.id}
                </span>
              </div>
            ))}
          </div>
          {data.buttons.map((b, i) => (
            <Handle
              key={`src-${b.id}-${i}`}
              type="source"
              position={Position.Right}
              id={`btn:${b.id}`}
              className="!bg-accent !h-2.5 !w-2.5"
              style={{ top: 'auto', bottom: buttonHandleBottom(i) }}
            />
          ))}
        </>
      ) : (
        <Handle
          type="source"
          position={Position.Right}
          id="next"
          className="!bg-accent !h-2.5 !w-2.5"
        />
      )}
      <p className="mt-2 truncate font-mono text-[10px] text-muted">{id}</p>
    </div>
  )
}

function HandoffNodeView({ id, data, selected }: NodeProps<Node<CanvasData>>) {
  return (
    <div
      className={`min-w-[200px] rounded-xl border bg-surface-strong p-3 shadow-sm ${
        selected ? 'border-accent' : 'border-line'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent" />
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
      className={`min-w-[160px] rounded-xl border bg-surface-strong p-3 shadow-sm ${
        selected ? 'border-accent' : 'border-line'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!bg-accent" />
      <p className="text-xs font-medium text-muted">Fin del flujo</p>
      <p className="mt-1 text-sm">Cierra sin derivar ni enviar más.</p>
      <p className="mt-2 truncate font-mono text-[10px] text-muted">{id}</p>
    </div>
  )
}

const nodeTypes = {
  message: MessageNodeView,
  handoff: HandoffNodeView,
  end: EndNodeView,
}

function toRfKind(kind: FlowNodeKind): 'message' | 'handoff' | 'end' {
  if (kind === 'handoff_human') return 'handoff'
  if (kind === 'end') return 'end'
  return 'message'
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
}: FlowCanvasEditorProps) {
  const [advisors, setAdvisors] = useState<Advisor[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)

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
      const mapped: FlowEditorNode[] = nextNodes.map((n, i) => {
        const kind =
          n.type === 'handoff'
            ? 'handoff_human'
            : n.type === 'end'
              ? 'end'
              : n.data.buttons.length > 0
                ? 'message_buttons'
                : 'message_text'
        return {
          client_key: n.id,
          kind,
          body_text: n.data.body_text,
          buttons: kind === 'message_buttons' ? n.data.buttons : [],
          position_x: n.position.x,
          position_y: n.position.y,
          handoff_user_id: n.data.handoff_user_id,
          sort_order: i,
        } as FlowEditorNode
      })
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
      setRfEdges((eds) => {
        // Una sola salida por handle (key de botón)
        const without = connection.sourceHandle
          ? eds.filter(
              (e) =>
                !(
                  e.source === connection.source &&
                  e.sourceHandle === connection.sourceHandle
                ),
            )
          : eds
        const next = addEdge(
          {
            ...connection,
            markerEnd: { type: MarkerType.ArrowClosed },
            label:
              connection.sourceHandle?.startsWith('btn:')
                ? connection.sourceHandle.slice(4)
                : 'siguiente',
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
      if (patch.buttons) {
        const kind =
          patch.buttons.length > 0 ? 'message_buttons' : 'message_text'
        data.kind = kind as FlowNodeKind
      }
      return { ...n, data }
    })
    let nextEdges = rfEdges
    if (patch.buttons && selectedNode) {
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

  const selected = rfNodes.find((n) => n.id === selectedId)

  function handleFormSubmit(e: FormEvent) {
    e.preventDefault()
    const mapped: FlowEditorNode[] = rfNodes.map((n) => {
      const kind =
        n.type === 'handoff'
          ? ('handoff_human' as const)
          : n.type === 'end'
            ? ('end' as const)
            : n.data.buttons.length > 0
              ? ('message_buttons' as const)
              : ('message_text' as const)
      return {
        client_key: n.id,
        kind,
        body_text: n.data.body_text,
        buttons: kind === 'message_buttons' ? n.data.buttons : [],
        position_x: n.position.x,
        position_y: n.position.y,
        handoff_user_id: n.data.handoff_user_id,
      }
    })
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

  return (
    <form className="flex h-full min-h-[70vh] flex-col gap-3 p-3 md:p-4" onSubmit={handleFormSubmit}>
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
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm"
            onClick={() => addCanvasNode('message_buttons')}
          >
            + Mensaje
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm"
            onClick={() => addCanvasNode('handoff_human')}
          >
            + Derivar
          </button>
          <button
            type="button"
            className="rounded-lg border border-line px-3 py-2 text-sm"
            onClick={() => addCanvasNode('end')}
          >
            + Fin
          </button>
        </div>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Guardando…' : submitLabel}
        </button>
        {onDelete ? (
          <button
            type="button"
            className="btn btn-ghost text-bad"
            disabled={deleting}
            onClick={onDelete}
          >
            {deleting ? 'Eliminando…' : 'Eliminar'}
          </button>
        ) : null}
      </div>
      {metricsNote ? (
        <p className="muted campaign-drilldown-dialog__note text-sm">{metricsNote}</p>
      ) : (
        <p className="text-xs text-muted">
          Arrastra desde el punto de cada botón (key) hacia el siguiente nodo.
          Cada key debe ser única en el flujo. Solo cuenta el último mensaje del
          asistente: un botón de un paso anterior no cambia de rama.
        </p>
      )}

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[1fr_280px]">
        <div className="min-h-[420px] overflow-hidden rounded-xl border border-line bg-surface">
          <ReactFlow
            nodes={rfNodes}
            edges={rfEdges}
            onNodesChange={onNodesChange}
            onEdgesChange={(chs) => {
              onEdgesChange(chs)
            }}
            onNodeDragStop={(_e, _node, nodes) => {
              syncOut(nodes as Node<CanvasData>[], rfEdges)
            }}
            onConnect={onConnect}
            onSelectionChange={({ nodes: sel }) => {
              setSelectedId(sel[0]?.id ?? null)
            }}
            nodeTypes={nodeTypes}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            connectionRadius={28}
            proOptions={{ hideAttribution: true }}
            defaultEdgeOptions={{
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>

        <aside className="space-y-3 rounded-xl border border-line bg-surface-strong p-3">
          {!selected ? (
            <p className="text-sm text-muted">
              Selecciona un nodo para editarlo. Marca uno como inicio abajo.
            </p>
          ) : (
            <>
              <p className="text-sm font-medium">
                {selected.type === 'handoff'
                  ? 'Derivar'
                  : selected.type === 'end'
                    ? 'Fin'
                    : 'Mensaje'}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={entryClientKey === selected.id}
                  onChange={() => setEntryClientKey(selected.id)}
                />
                Nodo inicial
              </label>
              {selected.type !== 'end' ? (
                <label className="block text-sm">
                  <span className="text-muted">Texto</span>
                  <textarea
                    className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                    rows={4}
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
              {selected.type === 'message' ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted">Botones (título + key, máx. 3)</p>
                  {selected.data.buttons.map((b, idx) => (
                    <div key={idx} className="space-y-1 rounded-lg border border-line p-2">
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
                        className="text-xs text-bad"
                        onClick={() =>
                          updateSelected({
                            buttons: selected.data.buttons.filter((_, i) => i !== idx),
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
                      className="text-sm"
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
                          ? advisors.find((a) => a.id === Number(e.target.value))
                              ?.label
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
                className="text-sm text-bad"
                onClick={removeSelected}
              >
                Eliminar nodo
              </button>
            </>
          )}
        </aside>
      </div>
    </form>
  )
}