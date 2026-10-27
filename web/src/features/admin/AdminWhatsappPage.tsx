import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/shadcn/dialog'

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

/** Convención MALI: PIN = 6 primeros dígitos del número nacional (sin 51). */
function defaultPinFromDisplayPhone(displayPhone: string | null | undefined): string {
  const digits = String(displayPhone || '').replace(/\D/g, '')
  if (!digits) return ''
  const national =
    digits.startsWith('51') && digits.length > 8 ? digits.slice(2) : digits
  return national.slice(0, 6)
}

export function AdminWhatsappPage() {
  const { confirm, confirmDialog } = useConfirmDialog()
  const [data, setData] = useState<WhatsAppOverview | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [validatingId, setValidatingId] = useState<number | null>(null)
  const [switchingId, setSwitchingId] = useState<number | null>(null)
  const [categories, setCategories] = useState<{ id: number | null; slug: string; label: string; active: boolean }[]>([])
  const [draft, setDraft] = useState({
    businessAreaId: '',
    programId: '',
    wabaId: '',
    label: '',
    phoneNumberId: '',
  })
  const [creating, setCreating] = useState(false)
  const [syncingWabaId, setSyncingWabaId] = useState<number | null>(null)
  const [subscribingWabaId, setSubscribingWabaId] = useState<number | null>(null)
  const [registerLine, setRegisterLine] = useState<WhatsAppOverview['lines'][number] | null>(null)
  const [registerPin, setRegisterPin] = useState('')
  const [registering, setRegistering] = useState(false)

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

  async function syncWabaLines(wabaId: number, wabaLabel: string) {
    const accepted = await confirm({
      title: 'Sincronizar números con Meta',
      description: `Consulta la WABA «${wabaLabel}» en Meta. Los números nuevos se crean inactivos; no se activan solos ni se borran líneas.`,
      confirmLabel: 'Sincronizar',
    })
    if (!accepted) return
    setSyncingWabaId(wabaId)
    const result = await apiClient.post<{
      created: { label: string }[]
      updated: { label: string }[]
      unchanged: unknown[]
      missing_in_meta: { label: string }[]
      skipped: { reason: string }[]
      meta_count: number
    }>(`/api/admin/whatsapp/wabas/${wabaId}/sync-lines`, {})
    setSyncingWabaId(null)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    const { created, updated, unchanged, missing_in_meta, skipped, meta_count } = result.data
    const parts = [
      `${meta_count} en Meta`,
      `${created.length} nuevas`,
      `${updated.length} actualizadas`,
      `${unchanged.length} igual`,
    ]
    if (missing_in_meta.length) parts.push(`${missing_in_meta.length} solo en Mali`)
    if (skipped.length) parts.push(`${skipped.length} omitidas`)
    notify.success(`Sincronización: ${parts.join(' · ')}.`)
    load()
  }

  async function subscribeWaba(wabaId: number, wabaLabel: string) {
    const accepted = await confirm({
      title: 'Suscribir app a la WABA',
      description: `Suscribe esta app a «${wabaLabel}» para recibir webhooks de mensajes entrantes.`,
      confirmLabel: 'Suscribir',
    })
    if (!accepted) return
    setSubscribingWabaId(wabaId)
    const result = await apiClient.post<{
      inspection?: { appSubscriptionStatus?: string }
    }>(`/api/admin/whatsapp/wabas/${wabaId}/subscribe`, {})
    setSubscribingWabaId(null)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    const status = result.data.inspection?.appSubscriptionStatus || 'ok'
    notify.success(`Suscripción: ${status}.`)
    load()
  }

  async function submitRegister() {
    if (!registerLine) return
    if (!/^\d{6}$/.test(registerPin.trim())) {
      notify.error('El PIN debe ser de 6 dígitos.')
      return
    }
    setRegistering(true)
    const result = await apiClient.post(`/api/admin/whatsapp/lines/${registerLine.id}/register`, {
      pin: registerPin.trim(),
    })
    setRegistering(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success('Número registrado en Cloud API. Ya puedes Activar.')
    setRegisterLine(null)
    setRegisterPin('')
    load()
  }

  async function setLineActive(line: WhatsAppOverview['lines'][number], active: boolean) {
    if (!active) {
      const accepted = await confirm({
        title: 'Desactivar línea',
        description: `${line.label} deja de enviar y de recibir por este número.`,
        confirmLabel: 'Desactivar',
        tone: 'danger',
      })
      if (!accepted) return
    }
    setSwitchingId(line.id)
    const result = await apiClient.post(
      `/api/admin/whatsapp/lines/${line.id}/${active ? 'activate' : 'deactivate'}`,
      {},
    )
    setSwitchingId(null)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success(active ? 'Línea activada.' : 'Línea desactivada.')
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
  const grouped = data.areas.flatMap((area) => {
    const lines = data.lines.filter((line) => line.area_slug === area.slug)
    if (!lines.length) return []
    const usesCategories =
      area.programs.some((program) => program.active) || lines.some((line) => line.program_id != null)
    if (!usesCategories) {
      return [{ key: area.slug, label: area.label, categories: [{ key: 'lines', label: null, lines }] }]
    }
    const placed = new Set<number>()
    const categories: { key: string; label: string | null; lines: typeof lines }[] = []
    const general = lines.filter((line) => line.program_id == null)
    if (general.length) {
      general.forEach((line) => placed.add(line.id))
      categories.push({ key: 'general', label: 'General', lines: general })
    }
    for (const program of area.programs) {
      const bucket = lines.filter((line) => line.program_id === program.id)
      if (!bucket.length) continue
      bucket.forEach((line) => placed.add(line.id))
      categories.push({ key: String(program.id), label: program.label, lines: bucket })
    }
    const rest = lines.filter((line) => !placed.has(line.id))
    if (rest.length) {
      categories.push({ key: 'other', label: rest[0]?.program_label || 'Sin categoría', lines: rest })
    }
    return [{ key: area.slug, label: area.label, categories }]
  })

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
          Alta de línea. Hace falta el identificador de número de Meta y la WABA. El token sale de la WABA. Queda inactiva: primero Valida en Meta y después Activar.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="text-muted">Nombre</span>
            <input
              className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">Phone number id</span>
            <input
              className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
              value={draft.phoneNumberId}
              onChange={(event) => setDraft({ ...draft, phoneNumberId: event.target.value })}
            />
          </label>
          <label className="text-sm">
            <span className="text-muted">Área</span>
            <select
              className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
              value={draft.businessAreaId}
              onChange={(event) => setDraft({ ...draft, businessAreaId: event.target.value, programId: '' })}
            >
              <option value="">Elegir</option>
              {data.areas.map((area) => (
                <option key={area.id} value={area.id}>{area.label}</option>
              ))}
            </select>
          </label>
          {selectedArea?.slug === 'educacion' ? (
            <label className="text-sm">
              <span className="text-muted">Categoría</span>
              <select
                className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
                value={draft.programId}
                onChange={(event) => setDraft({ ...draft, programId: event.target.value })}
              >
                <option value="">General</option>
                {programs.map((program) => (
                  <option key={program.id} value={program.id}>{program.label}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="text-sm">
            <span className="text-muted">WABA</span>
            <select
              className="mt-1 block rounded-lg border border-line bg-surface px-3 py-2"
              value={draft.wabaId}
              onChange={(event) => setDraft({ ...draft, wabaId: event.target.value })}
            >
              <option value="">Elegir</option>
              {data.wabas.map((waba) => (
                <option key={waba.id} value={waba.id}>{waba.label}</option>
              ))}
            </select>
          </label>
          <button type="submit" className="small-btn" disabled={creating}>Crear</button>
        </div>
      </form>
      <p className="muted">
        {data.vault_configured
          ? 'La bóveda de tokens está configurada.'
          : 'La bóveda de tokens no está configurada. Las líneas siguen usando variables de entorno.'}
      </p>
      <section className="space-y-2 rounded-xl border border-line p-4">
        <h2 className="text-sm font-medium">WABA</h2>
        <p className="text-sm text-muted">
          Sincronizar trae números nuevos como borrador. Suscribir enlaza la app a la WABA (webhooks). En cada línea Pendiente: Registrar en Cloud API (PIN) → Activar.
        </p>
        <ul className="space-y-2">
          {data.wabas.map((waba) => (
            <li
              key={waba.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-2 last:border-b-0"
            >
              <div className="min-w-0">
                <p className="text-sm">
                  {waba.label}
                  {waba.active ? '' : ' · inactiva'}
                </p>
                <p className="text-sm text-muted">
                  …{waba.meta_waba_id.slice(-6)}
                  {' · '}
                  {waba.app_subscription_status || 'suscripción desconocida'}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <button
                  type="button"
                  className="small-btn secondary"
                  disabled={subscribingWabaId === waba.id || syncingWabaId === waba.id}
                  onClick={() => void subscribeWaba(waba.id, waba.label)}
                >
                  {subscribingWabaId === waba.id ? 'Suscribiendo…' : 'Suscribir app'}
                </button>
                <button
                  type="button"
                  className="small-btn"
                  disabled={syncingWabaId === waba.id || subscribingWabaId === waba.id}
                  onClick={() => void syncWabaLines(waba.id, waba.label)}
                >
                  {syncingWabaId === waba.id ? 'Sincronizando…' : 'Sincronizar con Meta'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <div className="space-y-4">
        {grouped.map((area) => (
          <section key={area.key} className="overflow-hidden rounded-xl border border-line">
            <h2 className="border-b border-line bg-surface-strong px-4 py-2 text-sm font-medium">{area.label}</h2>
            {area.categories.map((category, index) => (
              <div key={category.key} className={index < area.categories.length - 1 ? 'border-b border-line' : ''}>
                {category.label ? (
                  <h3 className="border-b border-line px-4 py-2 text-xs font-medium text-muted">{category.label}</h3>
                ) : null}
                <ul>
                  {category.lines.map((line) => (
                    <li
                      key={line.id}
                      className={`flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0 ${category.label ? 'pl-8 pr-4' : 'px-4'}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm">
                          {line.label}
                          {line.is_default ? ' · predeterminada' : ''}
                          {line.active ? '' : ' · inactiva'}
                        </p>
                        <p className="text-sm text-muted">
                          {line.display_phone_number || 'Sin número visible'}
                          {' · WABA …'}
                          {line.meta_waba_id.slice(-6)}
                          {' · '}
                          {line.registration_status}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {line.area_slug === 'educacion' ? (
                          <select
                            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
                            aria-label="Categoría"
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
                            {categories.map((item) => (
                              <option key={item.slug} value={item.id ?? ''}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        ) : null}
                        <button
                          type="button"
                          className="small-btn secondary"
                          title={
                            line.registration_status === 'validated'
                              ? 'Ya registrado en Cloud API'
                              : undefined
                          }
                          disabled={
                            line.registration_status === 'validated' ||
                            validatingId === line.id ||
                            switchingId === line.id ||
                            registering
                          }
                          onClick={() => {
                            setRegisterPin(defaultPinFromDisplayPhone(line.display_phone_number))
                            setRegisterLine(line)
                          }}
                        >
                          Registrar Cloud API
                        </button>
                        <button
                          type="button"
                          className="small-btn"
                          disabled={validatingId === line.id || switchingId === line.id}
                          onClick={() => void validateLine(line.id)}
                        >
                          {validatingId === line.id ? 'Validando…' : 'Validar en Meta'}
                        </button>
                        <button
                          type="button"
                          className={line.active ? 'small-btn secondary' : 'small-btn'}
                          disabled={validatingId === line.id || switchingId === line.id}
                          onClick={() => void setLineActive(line, !line.active)}
                        >
                          {switchingId === line.id
                            ? 'Guardando…'
                            : line.active
                              ? 'Desactivar'
                              : 'Activar'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
        ))}
      </div>
      {confirmDialog}
      <Dialog
        open={registerLine != null}
        onOpenChange={(open) => {
          if (!open) {
            setRegisterLine(null)
            setRegisterPin('')
          }
        }}
      >
        <DialogContent className="w-[min(96vw,420px)]">
          <DialogHeader>
            <DialogTitle>Registrar en Cloud API</DialogTitle>
            <DialogDescription>
              {registerLine
                ? `Pasa «${registerLine.label}» de Pendiente a Conectado. Se sugiere el PIN con los 6 primeros dígitos del número (${registerLine.display_phone_number || '—'}). Si en Meta ya tenías otro PIN, cámbialo aquí.`
                : null}
            </DialogDescription>
          </DialogHeader>
          <label className="block text-sm">
            <span className="text-muted">PIN (6 dígitos)</span>
            <input
              className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2 tracking-widest"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={registerPin}
              onChange={(event) =>
                setRegisterPin(event.target.value.replace(/\D/g, '').slice(0, 6))
              }
            />
          </label>
          <DialogFooter>
            <DialogClose disabled={registering}>Cancelar</DialogClose>
            <button
              type="button"
              className="small-btn"
              disabled={registering || registerPin.length !== 6}
              onClick={() => void submitRegister()}
            >
              {registering ? 'Registrando…' : 'Registrar'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
