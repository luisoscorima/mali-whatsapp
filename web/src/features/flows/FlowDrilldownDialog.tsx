import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { formatDateTime } from '@/shared/format'
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'
import type { FlowEventContactRow } from './flowEditorUtils'

export type FlowDrilldownQuery = {
  title: string
  event_type: string
  client_key?: string
}

type FlowDrilldownDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  flowId: number
  query: FlowDrilldownQuery | null
}

function ChatLinkButton({
  conversationId,
  contactId,
}: {
  conversationId: number
  contactId?: number | null
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      disabled={busy}
      className="mt-1 text-xs text-accent hover:underline disabled:opacity-60"
      onClick={() => {
        if (contactId) {
          setBusy(true)
          void apiClient
            .post<{ id: number }>(`/api/conversations/from-contact/${contactId}`, {})
            .then((res) => {
              setBusy(false)
              if (res.ok) navigate(`/conversations/${res.data.id}`)
              else navigate(`/conversations/${conversationId}`)
            })
          return
        }
        navigate(`/conversations/${conversationId}`)
      }}
    >
      {busy ? 'Abriendo…' : 'Ir al chat'}
    </button>
  )
}

export function FlowDrilldownDialog({
  open,
  onOpenChange,
  flowId,
  query,
}: FlowDrilldownDialogProps) {
  const [rows, setRows] = useState<FlowEventContactRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !query) return
    setLoading(true)
    setError('')
    const params = new URLSearchParams()
    params.set('event_type', query.event_type)
    if (query.client_key) params.set('client_key', query.client_key)
    void apiClient
      .get<FlowEventContactRow[]>(`/api/flows/${flowId}/events?${params}`)
      .then((res) => {
        setLoading(false)
        if (!res.ok) {
          setError(res.error)
          setRows([])
          return
        }
        setRows(res.data)
      })
  }, [open, query, flowId])

  if (!query) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{query.title}</DialogTitle>
          <DialogDescription>
            Contactos asociados a esta métrica del flujo.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {loading ? (
            <p className="muted text-sm">Cargando…</p>
          ) : error ? (
            <p className="text-sm text-bad">{error}</p>
          ) : rows.length === 0 ? (
            <p className="muted text-sm">Sin contactos en esta métrica.</p>
          ) : (
            <ul className="max-h-80 space-y-2 overflow-y-auto text-sm">
              {rows.map((row) => (
                <li
                  key={`${row.conversation_id}-${row.created_at}-${row.event_type}`}
                  className="rounded-lg border border-line px-3 py-2"
                >
                  <p className="font-medium">{row.contact_name}</p>
                  <p className="font-mono text-xs text-muted">{row.phone}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(row.created_at)}
                    {row.match_payload ? ` · ${row.match_payload}` : ''}
                  </p>
                  <ChatLinkButton
                    conversationId={row.conversation_id}
                    contactId={row.contact_id}
                  />
                </li>
              ))}
            </ul>
          )}
        </DialogBody>
        <DialogFooter>
          <DialogClose>Cerrar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
