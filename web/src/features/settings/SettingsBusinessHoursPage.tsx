import { useEffect, useState } from 'react'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

type BusinessHoursSettings = {
  area: string
  enabled: boolean
  timezone: string
  days: number[]
  from: string
  to: string
  outside_hours_message: string
}

export function SettingsBusinessHoursPage() {
  const [settings, setSettings] = useState<BusinessHoursSettings | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [days, setDays] = useState<Set<number>>(new Set([1, 2, 3, 4, 5]))
  const [from, setFrom] = useState('09:00')
  const [to, setTo] = useState('18:00')
  const [message, setMessage] = useState('')
  const [timezone, setTimezone] = useState('America/Lima')
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiClient
      .get<BusinessHoursSettings>('/api/settings/business-hours')
      .then((result) => {
        if (!result.ok) {
          notify.error(result.error)
          setLoadFailed(true)
          return
        }
        setSettings(result.data)
        setEnabled(result.data.enabled)
        setDays(new Set(result.data.days))
        setFrom(result.data.from)
        setTo(result.data.to)
        setMessage(result.data.outside_hours_message)
        setTimezone(result.data.timezone)
      })
  }, [])

  function toggleDay(day: number) {
    setDays((prev) => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  async function handleSave() {
    if (!settings) return
    const dayList = [...days].sort((a, b) => a - b)
    if (enabled && dayList.length === 0) {
      notify.error('Selecciona al menos un día.')
      return
    }
    setBusy(true)
    const result = await apiClient.patch(
      `/api/settings/business-hours/${settings.area}`,
      {
        enabled,
        timezone,
        days: dayList,
        from: from.slice(0, 5),
        to: to.slice(0, 5),
        outside_hours_message: message.trim(),
      },
    )
    setBusy(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success('Guardado.')
  }

  if (loadFailed) {
    return <p className="text-muted">No se pudieron cargar los horarios.</p>
  }

  if (!settings) {
    return <p className="text-muted">Cargando…</p>
  }

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
      <h2 className="text-lg font-semibold">
        Fuera de horario · {settings.area}
      </h2>
      <p className="text-sm text-muted">
        Fuera de este horario se envía el mensaje predefinido una sola vez por chat
        hasta que un asesor lo abra. No usa IA.
      </p>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        Activar mensaje fuera de horario
      </label>

      <fieldset className="space-y-2 border-0 p-0">
        <legend className="text-sm font-medium">Días de atención</legend>
        <div className="flex flex-wrap gap-3">
          {DAY_LABELS.map((label, day) => (
            <label key={day} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={days.has(day)}
                onChange={() => toggleDay(day)}
              />
              {label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-4 text-sm">
        <label>
          <span className="text-muted">Desde</span>
          <input
            type="time"
            className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </label>
        <label>
          <span className="text-muted">Hasta</span>
          <input
            type="time"
            className="mt-1 block rounded-lg border border-line bg-surface px-2 py-1"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </label>
      </div>

      <p className="text-xs text-muted">Zona horaria: {timezone}</p>

      <label className="block text-sm">
        <span className="font-medium">Mensaje predefinido (fuera de horario)</span>
        <textarea
          className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2"
          rows={5}
          maxLength={4096}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ej.: Gracias por escribir. Te responderemos en horario de atención."
        />
      </label>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
          disabled={busy}
          onClick={() => handleSave()}
        >
          {busy ? 'Guardando…' : 'Guardar horario'}
        </button>
      </div>
    </section>
  )
}
