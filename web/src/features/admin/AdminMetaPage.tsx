import { type FormEvent, useState, useEffect } from 'react'
import { notify } from '@/shared/notify'
import { apiClient } from '../../shared/api'
import { ModulePageHeader } from '@/shared/ui/ModulePageHeader'
import { AREA_OPTIONS } from './areaLabels'

type MetaView = {
  global: { verify_token: string; app_secret: string }
  areas: Record<
    string,
    {
      whatsapp_token: string
      phone_number_id: string
      waba_id: string
      page_access_token: string
      page_id: string
    }
  >
}

function SecretField({
  label,
  helper,
  value,
  revealed,
  onChange,
  onToggle,
}: {
  label: string
  helper?: string
  value: string
  revealed: boolean
  onChange: (value: string) => void
  onToggle: () => void
}) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium">{label}</span>
      {helper ? <p className="text-xs text-muted">{helper}</p> : null}
      <div className="flex gap-2">
        <input
          type={revealed ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-line px-3 py-2 text-sm"
          autoComplete="off"
        />
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded-lg border border-line px-3 py-2 text-sm hover:bg-accent-soft"
        >
          {revealed ? 'Ocultar' : 'Ver'}
        </button>
      </div>
    </label>
  )
}

export function AdminMetaPage() {
  const [data, setData] = useState<MetaView | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedArea, setSelectedArea] = useState('ti')
  const [busy, setBusy] = useState(false)
  const [reveal, setReveal] = useState<Record<string, boolean>>({})

  function load() {
    apiClient.get<MetaView>('/api/admin/meta').then((result) => {
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

  function toggleReveal(key: string) {
    setReveal((prev) => {
      const next = !prev[key]
      if (next) {
        notify.info('Los secretos quedan visibles en pantalla. Ocúltalos al terminar.')
      }
      return { ...prev, [key]: next }
    })
  }

  function updateGlobal(field: 'verify_token' | 'app_secret', value: string) {
    setData((current) =>
      current
        ? { ...current, global: { ...current.global, [field]: value } }
        : current,
    )
  }

  function updateArea(
    area: string,
    field:
      | 'whatsapp_token'
      | 'phone_number_id'
      | 'waba_id'
      | 'page_access_token'
      | 'page_id',
    value: string,
  ) {
    setData((current) => {
      if (!current) return current
      return {
        ...current,
        areas: {
          ...current.areas,
          [area]: { ...current.areas[area], [field]: value },
        },
      }
    })
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!data) return
    setBusy(true)
    const result = await apiClient.patch<MetaView>('/api/admin/meta', data)
    setBusy(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setData(result.data)
    notify.success('Configuración guardada.')
  }

  if (loadFailed) return <p className="text-muted">No se pudo cargar</p>
  if (!data) return <p className="text-muted">Cargando credenciales…</p>

  const areaRow = data.areas[selectedArea] ?? {
    whatsapp_token: '',
    phone_number_id: '',
    waba_id: '',
    page_access_token: '',
    page_id: '',
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="max-w-2xl space-y-4">
      <ModulePageHeader
        title="Credenciales Meta"
        description="Los valores guardados tienen prioridad sobre .env. Deja un campo vacío y guarda para usar solo el entorno."
      />

      <fieldset className="space-y-3 rounded-xl border border-line bg-surface-strong p-4">
        <legend className="px-1 text-sm font-medium">Webhook (global)</legend>
        <SecretField
          label="Token de verificación"
          helper="Verify token — lo usa Meta al validar el webhook"
          value={data.global.verify_token}
          revealed={Boolean(reveal.verify_token)}
          onChange={(v) => updateGlobal('verify_token', v)}
          onToggle={() => toggleReveal('verify_token')}
        />
        <SecretField
          label="Secreto de la app"
          helper="App Secret — firma de webhooks"
          value={data.global.app_secret}
          revealed={Boolean(reveal.app_secret)}
          onChange={(v) => updateGlobal('app_secret', v)}
          onToggle={() => toggleReveal('app_secret')}
        />
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border border-line bg-surface-strong p-4">
        <legend className="px-1 text-sm font-medium">Por área</legend>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Área</span>
          <select
            value={selectedArea}
            onChange={(e) => setSelectedArea(e.target.value)}
            className="rounded-lg border border-line px-3 py-2 text-sm"
          >
            {AREA_OPTIONS.map((item) => (
              <option key={item.slug} value={item.slug}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <SecretField
          label="Token de WhatsApp"
          helper="Access token de Cloud API para esta área"
          value={areaRow.whatsapp_token}
          revealed={Boolean(reveal[`${selectedArea}.whatsapp_token`])}
          onChange={(v) => updateArea(selectedArea, 'whatsapp_token', v)}
          onToggle={() => toggleReveal(`${selectedArea}.whatsapp_token`)}
        />
        <label className="block space-y-1">
          <span className="text-sm font-medium">ID del número</span>
          <p className="text-xs text-muted">Phone number ID en Meta</p>
          <input
            type="text"
            value={areaRow.phone_number_id}
            onChange={(e) =>
              updateArea(selectedArea, 'phone_number_id', e.target.value)
            }
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm font-medium">ID de WABA (opcional)</span>
          <p className="text-xs text-muted">WhatsApp Business Account ID</p>
          <input
            type="text"
            value={areaRow.waba_id}
            onChange={(e) => updateArea(selectedArea, 'waba_id', e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </label>
        <SecretField
          label="Token de página (Lead Ads)"
          helper="Page access token"
          value={areaRow.page_access_token}
          revealed={Boolean(reveal[`${selectedArea}.page_access_token`])}
          onChange={(v) => updateArea(selectedArea, 'page_access_token', v)}
          onToggle={() => toggleReveal(`${selectedArea}.page_access_token`)}
        />
        <label className="block space-y-1">
          <span className="text-sm font-medium">ID de página (Lead Ads)</span>
          <p className="text-xs text-muted">Page ID</p>
          <input
            type="text"
            value={areaRow.page_id}
            onChange={(e) => updateArea(selectedArea, 'page_id', e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </label>
      </fieldset>

      <button
        type="submit"
        disabled={busy}
        className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? 'Guardando…' : 'Guardar'}
      </button>
    </form>
  )
}
