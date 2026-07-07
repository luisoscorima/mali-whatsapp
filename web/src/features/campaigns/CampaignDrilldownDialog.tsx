import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { formatDateTime } from '@/shared/format'
import { formatContactName } from '../contacts/contactName'
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
import { filterCampaignLogs, filterIncidentLogs } from './campaignLogFilters'
import type { MetricAction } from './campaignMetricActions'

type CampaignLog = {
  id: number
  phone: string
  status: string
  contact_id?: number | null
  contact_name?: string
  segment_labels?: string
  created_at: string
  error_summary?: string
  incident_label?: string
  incident_type?: string
}

type ResponderRow = {
  phone: string
  contact_id?: number | null
  contact_name: string
  segment_labels: string
  first_response_at: string
  interactive_response_text: string
}

type CampaignDrilldownDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  action: MetricAction | null
  campaignId: number
  logs: CampaignLog[]
  failedLogs: CampaignLog[]
  responders: ResponderRow[]
  responseTypeSummary?: { label: string; count: number }[]
  responseWindowDays?: number
}

function ChatLinkButton({ contactId }: { contactId?: number | null }) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  if (!contactId) return null
  return (
    <button
      type="button"
      disabled={busy}
      className="mt-1 text-xs text-accent hover:underline disabled:opacity-60"
      onClick={() => {
        setBusy(true)
        void apiClient
          .post<{ id: number }>(`/api/conversations/from-contact/${contactId}`, {})
          .then((res) => {
            setBusy(false)
            if (res.ok) navigate(`/conversations/${res.data.id}`)
          })
      }}
    >
      {busy ? 'Abriendo…' : 'Ir al chat'}
    </button>
  )
}

export function CampaignDrilldownDialog({
  open,
  onOpenChange,
  action,
  campaignId,
  logs,
  failedLogs,
  responders,
  responseTypeSummary = [],
  responseWindowDays,
}: CampaignDrilldownDialogProps) {
  if (!action) return null

  if (action.type === 'concepts') {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leyenda de conceptos Meta</DialogTitle>
            <DialogDescription>
              Estados del registro de envío según confirmaciones de WhatsApp.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <p className="muted campaign-drilldown-dialog__note text-sm leading-relaxed">
              <strong>sent</strong> — Meta aceptó el mensaje.
              <br />
              <strong>delivered</strong> — Llegó al dispositivo del usuario.
              <br />
              <strong>read</strong> — El usuario abrió el chat y lo leyó.
            </p>
          </DialogBody>
          <DialogFooter>
            <DialogClose>Cerrar</DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  const rows =
    action.type === 'logs'
      ? filterCampaignLogs(logs, action.filter)
      : action.type === 'incidents'
        ? filterIncidentLogs(failedLogs, action.filter)
        : responders

  const exportUrl =
    action.type === 'logs'
      ? `/api/campaigns/${campaignId}/logs-export?filter=${encodeURIComponent(action.filter)}`
      : action.type === 'incidents'
        ? `/api/campaigns/${campaignId}/incidents-export?filter=${encodeURIComponent(action.filter)}`
        : `/api/campaigns/${campaignId}/responders-export`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{action.title}</DialogTitle>
          {action.type === 'responders' && responseWindowDays ? (
            <DialogDescription>
              Ventana de {responseWindowDays} días tras el envío.
            </DialogDescription>
          ) : action.type !== 'responders' && 'note' in action && action.note ? (
            <DialogDescription>{action.note}</DialogDescription>
          ) : null}
        </DialogHeader>
        <DialogBody>
          {action.type === 'responders' && responseTypeSummary.length > 0 ? (
            <p className="muted campaign-drilldown-dialog__note mb-3 text-sm">
              {responseTypeSummary.map((item) => `${item.label}: ${item.count}`).join(' · ')}
            </p>
          ) : null}
          {rows.length === 0 ? (
            <p className="text-sm text-muted">Sin registros para este filtro.</p>
          ) : action.type === 'responders' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-2 pr-2">Contacto</th>
                  <th className="py-2 pr-2">Respuesta</th>
                  <th className="py-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {(rows as ResponderRow[]).map((row) => (
                  <tr key={`${row.phone}-${row.first_response_at}`} className="border-b border-line/60">
                    <td className="py-2 pr-2">
                      <div>{formatContactName(row.contact_name, null, row.phone)}</div>
                      <div className="text-xs text-muted">{row.phone}</div>
                      <ChatLinkButton contactId={row.contact_id} />
                    </td>
                    <td className="py-2 pr-2">{row.interactive_response_text || '—'}</td>
                    <td className="py-2 whitespace-nowrap">{formatDateTime(row.first_response_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : action.type === 'incidents' ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-2 pr-2">Teléfono</th>
                  <th className="py-2 pr-2">Tipo</th>
                  <th className="py-2">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {(rows as CampaignLog[]).map((row) => (
                  <tr key={row.id} className="border-b border-line/60">
                    <td className="py-2 pr-2">
                      <div>{row.phone}</div>
                      <ChatLinkButton contactId={row.contact_id} />
                    </td>
                    <td className="py-2 pr-2">{row.incident_label ?? row.incident_type ?? '—'}</td>
                    <td className="py-2">{row.error_summary ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-muted">
                  <th className="py-2 pr-2">Teléfono</th>
                  <th className="py-2 pr-2">Estado</th>
                  <th className="py-2">Fecha</th>
                </tr>
              </thead>
              <tbody>
                {(rows as CampaignLog[]).map((row) => (
                  <tr key={row.id} className="border-b border-line/60">
                    <td className="py-2 pr-2">
                      <div>{formatContactName(row.contact_name, null, row.phone)}</div>
                      <div className="text-xs text-muted">{row.phone}</div>
                      <ChatLinkButton contactId={row.contact_id} />
                    </td>
                    <td className="py-2 pr-2">{row.status}</td>
                    <td className="py-2 whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DialogBody>
        <DialogFooter>
          <button
            type="button"
            className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:bg-accent-soft"
            onClick={() => void apiClient.download(exportUrl)}
          >
            Exportar Excel
          </button>
          <DialogClose>Cerrar</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
