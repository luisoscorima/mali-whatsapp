import type { FormEvent } from 'react'
import {
  KIND_LABEL,
  nextClientKey,
  type FlowEditorEdge,
  type FlowEditorNode,
  type FlowNodeKind,
} from './flowEditorUtils'

type FlowEditorFormProps = {
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
  onSubmit: (e: FormEvent) => void
  submitLabel: string
  metricsNote?: string
  onDelete?: () => void
  deleting?: boolean
}

export function FlowEditorForm({
  name,
  setName,
  triggerPayload,
  setTriggerPayload,
  status,
  setStatus,
  entryClientKey,
  setEntryClientKey,
  nodes,
  setNodes,
  edges,
  setEdges,
  saving,
  onSubmit,
  submitLabel,
  metricsNote,
  onDelete,
  deleting,
}: FlowEditorFormProps) {
  function updateNode(key: string, patch: Partial<FlowEditorNode>) {
    setNodes(nodes.map((n) => (n.client_key === key ? { ...n, ...patch } : n)))
  }

  function removeNode(key: string) {
    if (nodes.length <= 1) return
    setNodes(nodes.filter((n) => n.client_key !== key))
    setEdges(
      edges.filter(
        (e) => e.from_client_key !== key && e.to_client_key !== key,
      ),
    )
    if (entryClientKey === key) {
      setEntryClientKey(nodes.find((n) => n.client_key !== key)?.client_key || '')
    }
  }

  function addNode(kind: FlowNodeKind) {
    const node: FlowEditorNode = {
      client_key: nextClientKey(),
      kind,
      body_text: '',
      buttons:
        kind === 'message_buttons'
          ? [{ id: 'BTN_NUEVO', title: 'Opción' }]
          : [],
    }
    setNodes([...nodes, node])
  }

  function addEdge(fromKey: string) {
    const to =
      nodes.find((n) => n.client_key !== fromKey)?.client_key ||
      nodes[0]?.client_key ||
      ''
    setEdges([
      ...edges,
      { from_client_key: fromKey, to_client_key: to, match_payload: null },
    ])
  }

  return (
    <form className="space-y-6 p-4 md:p-6 max-w-3xl" onSubmit={onSubmit}>
      <div>
        <h2 className="text-lg font-semibold">Flujo</h2>
        <p className="muted text-sm mt-1">
          El trigger debe coincidir con el texto del botón QUICK_REPLY de la
          plantilla (o con el payload del botón interactivo).
        </p>
        {metricsNote ? (
          <p className="muted campaign-drilldown-dialog__note mt-2">
            {metricsNote}
          </p>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Nombre</span>
          <input
            className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={150}
            autoComplete="off"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Trigger (payload)</span>
          <input
            className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2 font-mono text-sm"
            value={triggerPayload}
            onChange={(e) => setTriggerPayload(e.target.value)}
            required
            maxLength={256}
            placeholder="INICIAR_FLUJO_VENTAS"
            autoComplete="off"
          />
        </label>
        <label className="block text-sm">
          <span className="text-muted">Estado</span>
          <select
            className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
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
        <label className="block text-sm">
          <span className="text-muted">Paso inicial</span>
          <select
            className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
            value={entryClientKey}
            onChange={(e) => setEntryClientKey(e.target.value)}
          >
            {nodes.map((n, i) => (
              <option key={n.client_key} value={n.client_key}>
                Paso {i + 1}: {KIND_LABEL[n.kind]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Pasos</h3>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
              onClick={() => addNode('message_buttons')}
            >
              + Botones
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
              onClick={() => addNode('message_text')}
            >
              + Texto
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
              onClick={() => addNode('handoff_human')}
            >
              + Derivar
            </button>
            <button
              type="button"
              className="rounded-lg border border-line px-3 py-1.5 text-sm hover:bg-accent-soft"
              onClick={() => addNode('end')}
            >
              + Fin
            </button>
          </div>
        </div>

        {nodes.map((node, index) => (
          <div
            key={node.client_key}
            className="space-y-3 rounded-xl border border-line p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">
                Paso {index + 1} · {KIND_LABEL[node.kind]}
              </p>
              {nodes.length > 1 ? (
                <button
                  type="button"
                  className="text-sm text-bad"
                  onClick={() => removeNode(node.client_key)}
                >
                  Quitar
                </button>
              ) : null}
            </div>

            <label className="block text-sm">
              <span className="text-muted">Tipo</span>
              <select
                className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                value={node.kind}
                onChange={(e) => {
                  const kind = e.target.value as FlowNodeKind
                  updateNode(node.client_key, {
                    kind,
                    buttons:
                      kind === 'message_buttons'
                        ? node.buttons.length
                          ? node.buttons
                          : [{ id: 'BTN_A', title: 'Opción A' }]
                        : [],
                  })
                }}
              >
                {(Object.keys(KIND_LABEL) as FlowNodeKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>

            {node.kind !== 'end' ? (
              <label className="block text-sm">
                <span className="text-muted">
                  {node.kind === 'handoff_human'
                    ? 'Mensaje al derivar (opcional)'
                    : 'Texto del mensaje'}
                </span>
                <textarea
                  className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                  rows={3}
                  value={node.body_text}
                  onChange={(e) =>
                    updateNode(node.client_key, { body_text: e.target.value })
                  }
                  required={
                    node.kind === 'message_text' ||
                    node.kind === 'message_buttons'
                  }
                />
              </label>
            ) : null}

            {node.kind === 'message_buttons' ? (
              <div className="space-y-2">
                <p className="text-xs text-muted">Hasta 3 botones (título ≤ 20)</p>
                {node.buttons.map((btn, btnIdx) => (
                  <div
                    key={btnIdx}
                    className="grid gap-2 sm:grid-cols-2 rounded-lg border border-line p-2"
                  >
                    <label className="block text-sm">
                      <span className="text-muted">Título</span>
                      <input
                        className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                        value={btn.title}
                        maxLength={20}
                        onChange={(e) => {
                          const buttons = node.buttons.map((b, i) =>
                            i === btnIdx ? { ...b, title: e.target.value } : b,
                          )
                          updateNode(node.client_key, { buttons })
                        }}
                        required
                      />
                    </label>
                    <label className="block text-sm">
                      <span className="text-muted">Payload</span>
                      <input
                        className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2 font-mono text-sm"
                        value={btn.id}
                        maxLength={256}
                        onChange={(e) => {
                          const buttons = node.buttons.map((b, i) =>
                            i === btnIdx ? { ...b, id: e.target.value } : b,
                          )
                          updateNode(node.client_key, { buttons })
                        }}
                        required
                      />
                    </label>
                    {node.buttons.length > 1 ? (
                      <button
                        type="button"
                        className="text-sm text-bad sm:col-span-2"
                        onClick={() =>
                          updateNode(node.client_key, {
                            buttons: node.buttons.filter((_, i) => i !== btnIdx),
                          })
                        }
                      >
                        Quitar botón
                      </button>
                    ) : null}
                  </div>
                ))}
                {node.buttons.length < 3 ? (
                  <button
                    type="button"
                    className="rounded-lg border border-line px-3 py-1.5 text-sm"
                    onClick={() =>
                      updateNode(node.client_key, {
                        buttons: [
                          ...node.buttons,
                          {
                            id: `BTN_${node.buttons.length + 1}`,
                            title: `Opción ${node.buttons.length + 1}`,
                          },
                        ],
                      })
                    }
                  >
                    Añadir botón
                  </button>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-2 border-t border-line pt-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Ramas desde este paso</p>
                <button
                  type="button"
                  className="text-sm"
                  onClick={() => addEdge(node.client_key)}
                >
                  + Rama
                </button>
              </div>
              {edges
                .filter((e) => e.from_client_key === node.client_key)
                .map((edge, edgeIdx) => {
                  const globalIdx = edges.indexOf(edge)
                  return (
                    <div
                      key={`${edge.from_client_key}-${edgeIdx}`}
                      className="grid gap-2 sm:grid-cols-3 items-end"
                    >
                      <label className="block text-sm">
                        <span className="text-muted">Si payload</span>
                        <input
                          className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2 font-mono text-sm"
                          value={edge.match_payload ?? ''}
                          placeholder="(default)"
                          onChange={(e) => {
                            const next = [...edges]
                            next[globalIdx] = {
                              ...edge,
                              match_payload: e.target.value.trim() || null,
                            }
                            setEdges(next)
                          }}
                        />
                      </label>
                      <label className="block text-sm">
                        <span className="text-muted">Ir a paso</span>
                        <select
                          className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                          value={edge.to_client_key}
                          onChange={(e) => {
                            const next = [...edges]
                            next[globalIdx] = {
                              ...edge,
                              to_client_key: e.target.value,
                            }
                            setEdges(next)
                          }}
                        >
                          {nodes.map((n, i) => (
                            <option key={n.client_key} value={n.client_key}>
                              Paso {i + 1}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="text-sm text-bad pb-2"
                        onClick={() =>
                          setEdges(edges.filter((_, i) => i !== globalIdx))
                        }
                      >
                        Quitar rama
                      </button>
                    </div>
                  )
                })}
            </div>
          </div>
        ))}
      </section>

      <div className="flex flex-wrap gap-3">
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
    </form>
  )
}
