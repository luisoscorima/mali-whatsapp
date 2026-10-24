import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'

type WhatsAppOverview = {
  vault_configured: boolean
  wabas: {
    id: number
    meta_waba_id: string
    label: string
    active: boolean
    app_subscription_status: string
  }[]
  lines: {
    id: number
    area_label: string
    program_label: string | null
    label: string
    display_phone_number: string | null
    phone_number_id: string
    meta_waba_id: string
    is_default: boolean
    active: boolean
    registration_status: string
  }[]
}

export function AdminWhatsappPage() {
  const [data, setData] = useState<WhatsAppOverview | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [validatingId, setValidatingId] = useState<number | null>(null)

  function load() {
    void apiClient.get<WhatsAppOverview>('/api/admin/whatsapp').then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        setLoadFailed(true)
        return
      }
      setData(result.data)
    })
  }

  useEffect(() => {
    load()
  }, [])

  async function validateLine(id: number) {
    setValidatingId(id)
    const result = await apiClient.post<unknown>(`/api/admin/whatsapp/lines/${id}/validate`, {})
    setValidatingId(null)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success('Línea validada contra Meta.')
    load()
  }

  if (loadFailed) {
    return <p className="muted">No se pudo cargar el catálogo de líneas.</p>
  }
  if (!data) {
    return <p className="muted">Cargando…</p>
  }

  return (
    <div>
      <p className="muted">
        {data.vault_configured
          ? 'La bóveda de tokens está configurada.'
          : 'La bóveda de tokens no está configurada. Las líneas siguen usando variables de entorno.'}
      </p>
      <ul className="inbox-chat-list">
        {data.lines.map((line) => (
          <li key={line.id} className="inbox-chat-item">
            <p>
              {line.label}
              {line.is_default ? ' · predeterminada' : ''}
              {line.active ? '' : ' · inactiva'}
            </p>
            <p className="muted">
              {line.area_label}
              {line.program_label ? ` · ${line.program_label}` : ''}
              <br />
              {line.display_phone_number || 'Sin número visible'}
              {' · WABA …'}
              {line.meta_waba_id.slice(-6)}
              {' · estado '}
              {line.registration_status}
            </p>
            <button
              type="button"
              className="small-btn"
              disabled={validatingId === line.id}
              onClick={() => void validateLine(line.id)}
            >
              {validatingId === line.id ? 'Validando…' : 'Validar en Meta'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
