import { type FormEvent, useEffect, useState } from 'react'
import { notify } from '@/shared/notify'
import { apiClient } from '../../shared/api'
import { AREA_OPTIONS } from './areaLabels'

type MetaView = {
  global: { verify_token: string; app_secret: string }
  areas: Record<
    string,
    { whatsapp_token: string; phone_number_id: string; waba_id: string }
  >
}

export function AdminMetaPage() {
  const [data, setData] = useState<MetaView | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedArea, setSelectedArea] = useState('ti')
  const [showSecrets, setShowSecrets] = useState(false)

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

  function updateGlobal(field: 'verify_token' | 'app_secret', value: string) {
    setData((current) =>
      current
        ? { ...current, global: { ...current.global, [field]: value } }
        : current,
    )
  }

  function updateArea(
    area: string,
    field: 'whatsapp_token' | 'phone_number_id' | 'waba_id',
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
    const result = await apiClient.patch<MetaView>('/api/admin/meta', data)
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
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="max-w-2xl space-y-4">
      <h2 className="text-lg font-semibold">Credenciales Meta</h2>
      <p className="muted text-sm">
        Los valores guardados tienen prioridad sobre <code>.env</code>. Deja un campo
        vacío y guarda para usar solo el entorno.
      </p>

      <fieldset className="space-y-3 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-medium">Webhook (global)</legend>
        <label className="block space-y-1">
          <span className="text-sm">Verify token</span>
          <input
            type={showSecrets ? 'text' : 'password'}
            value={data.global.verify_token}
            onChange={(e) => updateGlobal('verify_token', e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">App Secret</span>
          <input
            type={showSecrets ? 'text' : 'password'}
            value={data.global.app_secret}
            onChange={(e) => updateGlobal('app_secret', e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </label>
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
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
        <button
          type="button"
          onClick={() => setShowSecrets((value) => !value)}
          className="rounded-lg border border-line px-3 py-2 text-sm hover:bg-accent-soft"
        >
          {showSecrets ? 'Ocultar secretos' : 'Mostrar secretos'}
        </button>
      </div>

      <fieldset className="space-y-3 rounded-xl border border-line p-4">
        <legend className="px-1 text-sm font-medium">
          {AREA_OPTIONS.find((item) => item.slug === selectedArea)?.label}
        </legend>
        <label className="block space-y-1">
          <span className="text-sm">Token WhatsApp</span>
          <input
            type={showSecrets ? 'text' : 'password'}
            value={areaRow.whatsapp_token}
            onChange={(e) =>
              updateArea(selectedArea, 'whatsapp_token', e.target.value)
            }
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm">Phone number ID</span>
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
          <span className="text-sm">WABA ID (opcional)</span>
          <input
            type="text"
            value={areaRow.waba_id}
            onChange={(e) => updateArea(selectedArea, 'waba_id', e.target.value)}
            className="w-full rounded-lg border border-line px-3 py-2 text-sm"
          />
        </label>
      </fieldset>

      <button
        type="submit"
        className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white"
      >
        Guardar
      </button>
    </form>
  )
}
