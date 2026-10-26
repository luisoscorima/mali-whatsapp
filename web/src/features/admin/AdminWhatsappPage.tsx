import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'

type WhatsAppOverview = {
  vault_configured: boolean
  areas: {
    id: number
    slug: string
    label: string
    programs: { id: number; slug: string; label: string; active: boolean }[]
  }[]
  wabas: {
    id: number
    meta_waba_id: string
    label: string
    active: boolean
    app_subscription_status: string
  }[]
  lines: {
    id: number
    area_slug: string
    area_label: string
    program_id: number | null
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
  const [categories, setCategories] = useState<{ id: number | null; slug: string; label: string; active: boolean }[]>([])
  const [draft, setDraft] = useState({
    businessAreaId: '',
    programId: '',
    wabaId: '',
    label: '',
    phoneNumberId: '',
  })
  const [creating, setCreating] = useState(false)

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
    void apiClient
      .get<{ id: number | null; slug: string; label: string; active: boolean }[]>(
        '/api/admin/areas/educacion/categories',
      )
      .then((result) => {
        if (result.ok) setCategories(result.data.filter((item) => item.active))
      })
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

  const selectedArea = data.areas.find((area) => String(area.id) === draft.businessAreaId)
  const programs = (selectedArea?.programs ?? []).filter((program) => program.active)

  return (
    <div className="space-y-4">
      <form
        className="space-y-2 rounded-xl border border-line p-4"
        onSubmit={(event) => {
          event.preventDefault()
          setCreating(true)
          void apiClient
            .post('/api/admin/whatsapp/lines', {
              business_area_id: Number(draft.businessAreaId),
              waba_id: Number(draft.wabaId),
              program_id: draft.programId ? Number(draft.programId) : null,
              label: draft.label,
              phone_number_id: draft.phoneNumberId,
            })
            .then((result) => {
              setCreating(false)
              if (!result.ok) {
                notify.error(result.error)
                return
              }
              setDraft({ businessAreaId: '', programId: '', wabaId: '', label: '', phoneNumberId: '' })
              notify.success('Línea creada como borrador. Valídala en Meta antes de usarla.')
              load()
            })
        }}
      >
        <p className="text-sm text-muted">
          Alta de línea. Hace falta el identificador de número de Meta y la WABA. El token sale de la WABA. Queda inactiva hasta validarla.
        </p>
        <div className="flex flex-wrap gap-2">
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            placeholder="Nombre"
            value={draft.label}
            onChange={(event) => setDraft({ ...draft, label: event.target.value })}
          />
          <input
            className="rounded-lg border border-line bg-surface px-3 py-2"
            placeholder="Phone number id"
            value={draft.phoneNumberId}
            onChange={(event) => setDraft({ ...draft, phoneNumberId: event.target.value })}
          />
          <select
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={draft.businessAreaId}
            onChange={(event) => setDraft({ ...draft, businessAreaId: event.target.value, programId: '' })}
          >
            <option value="">Área</option>
            {data.areas.map((area) => (
              <option key={area.id} value={area.id}>{area.label}</option>
            ))}
          </select>
          {selectedArea?.slug === 'educacion' ? (
            <select
              className="rounded-lg border border-line bg-surface px-3 py-2"
              value={draft.programId}
              onChange={(event) => setDraft({ ...draft, programId: event.target.value })}
            >
              <option value="">General</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>{program.label}</option>
              ))}
            </select>
          ) : null}
          <select
            className="rounded-lg border border-line bg-surface px-3 py-2"
            value={draft.wabaId}
            onChange={(event) => setDraft({ ...draft, wabaId: event.target.value })}
          >
            <option value="">WABA</option>
            {data.wabas.map((waba) => (
              <option key={waba.id} value={waba.id}>{waba.label}</option>
            ))}
          </select>
          <button type="submit" className="small-btn" disabled={creating}>Crear</button>
        </div>
      </form>
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
            {line.area_slug === 'educacion' ? (
              <label className="mt-2 block text-sm">
                <span className="text-muted">Categoría</span>
                <select
                  className="mt-1 rounded-lg border border-line bg-surface px-3 py-2"
                  value={line.program_id ?? ''}
                  onChange={(event) => {
                    const programId = event.target.value ? Number(event.target.value) : null
                    void apiClient
                      .patch(`/api/admin/whatsapp/lines/${line.id}/category`, { program_id: programId })
                      .then((result) => {
                        if (!result.ok) {
                          notify.error(result.error)
                          return
                        }
                        notify.success('La línea quedó en la categoría elegida. Sus chats se ven ahí.')
                        load()
                      })
                  }}
                >
                  {categories.map((category) => (
                    <option key={category.slug} value={category.id ?? ''}>
                      {category.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
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
