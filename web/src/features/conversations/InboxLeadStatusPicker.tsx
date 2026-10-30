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
  onSelect: (statusId: number) => void | boolean | Promise<void | boolean>
}

export function InboxLeadStatusPicker({
  currentStatusId,
  busy = false,
  onSelect,
}: InboxLeadStatusPickerProps) {
  const [options, setOptions] = useState<LeadStatusOption[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
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
  }, [])

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
