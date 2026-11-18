import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'

export type LeadStatusOption = {
  id: number
  slug: string
  label: string
  active: boolean
}

type InboxLeadStatusPickerProps = {
  currentStatusId: number | null
  busy?: boolean
  /** Educación sin ciclo abierto: mostrar iniciar atención en lugar de estados. */
  needsStartAttention?: boolean
  onStartAttention?: () => void | boolean | Promise<void | boolean>
  onSelect: (statusId: number) => void | boolean | Promise<void | boolean>
}

export function InboxLeadStatusPicker({
  currentStatusId,
  busy = false,
  needsStartAttention = false,
  onStartAttention,
  onSelect,
}: InboxLeadStatusPickerProps) {
  const [options, setOptions] = useState<LeadStatusOption[]>([])
  const [loading, setLoading] = useState(!needsStartAttention)

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
    return (
      <div className="inbox-oneclick-picker space-y-2 p-3">
        <p className="muted text-sm">
          Aún no hay ciclo iniciado en esta categoría. Inícialo para poder cambiar
          el estado.
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
          {busy ? 'Iniciando…' : 'Iniciar ciclo'}
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
