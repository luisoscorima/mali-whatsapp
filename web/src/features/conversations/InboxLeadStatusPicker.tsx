import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'

export type LeadStatusOption = {
  id: number
  slug: string
  label: string
  active: boolean
}

const CLOSE_WITHOUT_PAYMENT_REASONS = [
  { id: 'credito', label: 'Crédito / financiamiento' },
  { id: 'fuera_treasury', label: 'Pago fuera de Treasury' },
  { id: 'otro', label: 'Otro' },
] as const

type InboxLeadStatusPickerProps = {
  currentStatusId: number | null
  busy?: boolean
  /** Educación sin ciclo abierto: mostrar iniciar en lugar de estados. */
  needsStartAttention?: boolean
  /** Ciclo abierto en venta exitosa: asociar pago o cerrar sin pago. */
  needsAssociatePayment?: boolean
  /** Si el ciclo está cerrado, etiqueta del último estado (p. ej. Venta exitosa). */
  closedStatusLabel?: string | null
  onStartAttention?: () => void | boolean | Promise<void | boolean>
  onAssociatePayment?: () => void
  onCloseWithoutPayment?: (input: {
    reason: string
    note?: string
  }) => void | boolean | Promise<void | boolean>
  onSelect: (statusId: number) => void | boolean | Promise<void | boolean>
}

export function InboxLeadStatusPicker({
  currentStatusId,
  busy = false,
  needsStartAttention = false,
  needsAssociatePayment = false,
  closedStatusLabel = null,
  onStartAttention,
  onAssociatePayment,
  onCloseWithoutPayment,
  onSelect,
}: InboxLeadStatusPickerProps) {
  const [options, setOptions] = useState<LeadStatusOption[]>([])
  const [loading, setLoading] = useState(!needsStartAttention)
  const [closeReason, setCloseReason] = useState<string>('credito')
  const [closeNote, setCloseNote] = useState('')
  const [closingUnpaid, setClosingUnpaid] = useState(false)

  useEffect(() => {
    if (needsStartAttention) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    void apiClient
      .get<LeadStatusOption[]>('/api/leads/statuses')
      .then((r) => {
        if (cancelled) return
        setLoading(false)
        if (!r.ok) {
          notify.error(r.error)
          return
        }
        setOptions(r.data)
      })
    return () => {
      cancelled = true
    }
  }, [needsStartAttention])

  if (needsStartAttention) {
    const closed = Boolean(closedStatusLabel)
    return (
      <div className="inbox-oneclick-picker space-y-2 p-3">
        <p className="muted text-sm">
          {closed
            ? `Ciclo cerrado (${closedStatusLabel}). Inicia uno nuevo solo si corresponde otra venta.`
            : 'Aún no hay ciclo iniciado en esta categoría. Inícialo para poder cambiar el estado.'}
        </p>
        <button
          type="button"
          disabled={busy || !onStartAttention}
          className="w-full rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm font-medium disabled:opacity-60"
          onClick={() => {
            if (!onStartAttention) return
            void Promise.resolve(onStartAttention())
          }}
        >
          {busy ? 'Iniciando…' : closed ? 'Iniciar nuevo ciclo' : 'Iniciar ciclo'}
        </button>
      </div>
    )
  }

  if (loading) {
    return <p className="text-sm text-muted p-2">Cargando estados…</p>
  }

  const visible = options.filter((s) => s.active || s.id === currentStatusId)

  return (
    <div className="inbox-oneclick-picker">
      {needsAssociatePayment ? (
        <div className="space-y-2 border-b border-line p-3">
          <p className="muted text-sm">
            Venta registrada. Asocia el pago para cerrar el ciclo, o ciérralo sin
            pago si no aplica Treasury.
          </p>
          <button
            type="button"
            disabled={busy || !onAssociatePayment}
            className="w-full rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm font-medium disabled:opacity-60"
            onClick={() => onAssociatePayment?.()}
          >
            Asociar pago
          </button>
          {onCloseWithoutPayment ? (
            <div className="space-y-2">
              <label className="block text-xs text-muted">
                Cerrar sin pago
                <select
                  className="mt-1 w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                  value={closeReason}
                  disabled={busy || closingUnpaid}
                  onChange={(e) => setCloseReason(e.target.value)}
                >
                  {CLOSE_WITHOUT_PAYMENT_REASONS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
              {closeReason === 'otro' ? (
                <input
                  type="text"
                  className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
                  placeholder="Nota (opcional)"
                  value={closeNote}
                  disabled={busy || closingUnpaid}
                  onChange={(e) => setCloseNote(e.target.value)}
                />
              ) : null}
              <button
                type="button"
                disabled={busy || closingUnpaid}
                className="w-full rounded-lg border border-line px-3 py-2 text-sm disabled:opacity-60"
                onClick={() => {
                  setClosingUnpaid(true)
                  void Promise.resolve(
                    onCloseWithoutPayment({
                      reason: closeReason,
                      note: closeNote.trim() || undefined,
                    }),
                  ).finally(() => setClosingUnpaid(false))
                }}
              >
                {closingUnpaid ? 'Cerrando…' : 'Cerrar sin pago'}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
      <div
        className="inbox-oneclick-picker__list"
        role="listbox"
        aria-label="Estado del lead"
      >
        {visible.length === 0 ? (
          <p className="text-sm text-muted p-2">No hay estados configurados</p>
        ) : (
          visible.map((status) => (
            <button
              key={status.id}
              type="button"
              role="option"
              aria-selected={currentStatusId === status.id}
              disabled={busy}
              className={`inbox-oneclick-picker__option${currentStatusId === status.id ? ' is-active' : ''}`}
              onClick={() => void onSelect(status.id)}
            >
              {status.label}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
