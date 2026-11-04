import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { ModulePageHeader } from '@/shared/ui/ModulePageHeader'

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']

type SlaDay = { day: number; from: string; to: string }

type EducationSlaSettings = {
  target_minutes: number
  timezone: string
  days: SlaDay[]
  alerts_since: string | null
  min_target_minutes: number
  max_target_minutes: number
  purged?: number
}

const DEFAULT_DAYS: SlaDay[] = [
  { day: 0, from: '09:00', to: '18:00' },
  { day: 1, from: '08:30', to: '20:00' },
  { day: 2, from: '08:30', to: '20:00' },
  { day: 3, from: '08:30', to: '20:00' },
  { day: 4, from: '08:30', to: '20:00' },
  { day: 5, from: '08:30', to: '20:00' },
  { day: 6, from: '08:30', to: '18:00' },
]

function dayMap(days: SlaDay[]): Map<number, SlaDay> {
  return new Map(days.map((d) => [d.day, d]))
}

export function SettingsEducationSlaPage() {
  const [settings, setSettings] = useState<EducationSlaSettings | null>(null)
  const [targetMinutes, setTargetMinutes] = useState(10)
  const [enabledDays, setEnabledDays] = useState<Set<number>>(
    () => new Set(DEFAULT_DAYS.map((d) => d.day)),
  )
  const [windows, setWindows] = useState<Record<number, { from: string; to: string }>>(
    () => Object.fromEntries(DEFAULT_DAYS.map((d) => [d.day, { from: d.from, to: d.to }])),
  )
  const [loadFailed, setLoadFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [minTarget, setMinTarget] = useState(5)
  const [maxTarget, setMaxTarget] = useState(60)
  const [timezone, setTimezone] = useState('America/Lima')

  useEffect(() => {
    void apiClient.get<EducationSlaSettings>('/api/settings/education-sla').then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        setLoadFailed(true)
        return
      }
      const data = result.data
      setSettings(data)
      setTargetMinutes(data.target_minutes)
      setMinTarget(data.min_target_minutes)
      setMaxTarget(data.max_target_minutes)
      setTimezone(data.timezone)
      const map = dayMap(data.days.length ? data.days : DEFAULT_DAYS)
      setEnabledDays(new Set(map.keys()))
      const nextWindows: Record<number, { from: string; to: string }> = {}
      for (let day = 0; day <= 6; day += 1) {
        const row = map.get(day) ?? DEFAULT_DAYS.find((d) => d.day === day)
        nextWindows[day] = {
          from: row?.from ?? '09:00',
          to: row?.to ?? '18:00',
        }
      }
      setWindows(nextWindows)
    })
  }, [])

  const summary = useMemo(() => {
    const open = [...enabledDays]
      .sort((a, b) => a - b)
      .map((day) => {
        const win = windows[day]
        return `${DAY_LABELS[day]} ${win?.from ?? '—'}–${win?.to ?? '—'}`
      })
    if (!open.length) return 'Sin días activos'
    return `Meta ${targetMinutes} min · ${open.join(' · ')}`
  }, [enabledDays, windows, targetMinutes])

  function toggleDay(day: number) {
    setEnabledDays((prev) => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  }

  async function handleSave() {
    const days = [...enabledDays]
      .sort((a, b) => a - b)
      .map((day) => ({
        day,
        from: windows[day]?.from ?? '09:00',
        to: windows[day]?.to ?? '18:00',
      }))
    if (!days.length) {
      notify.error('Selecciona al menos un día.')
      return
    }
    setBusy(true)
    const result = await apiClient.patch<EducationSlaSettings>(
      '/api/settings/education-sla',
      { target_minutes: targetMinutes, days },
    )
    setBusy(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setSettings(result.data)
    notify.success('SLA guardado.')
  }

  async function handleResetDefaults() {
    setTargetMinutes(10)
    setEnabledDays(new Set(DEFAULT_DAYS.map((d) => d.day)))
    setWindows(
      Object.fromEntries(DEFAULT_DAYS.map((d) => [d.day, { from: d.from, to: d.to }])),
    )
  }

  async function handleStartFromNow() {
    const ok = window.confirm(
      '¿Empezar alertas desde ahora?\nSe borrarán las alertas históricas (sin atender y nuevo lead). Solo avisarán leads de ahora en adelante.',
    )
    if (!ok) return
    setBusy(true)
    const result = await apiClient.post<EducationSlaSettings>(
      '/api/settings/education-sla/reset-alerts',
      {},
    )
    setBusy(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setSettings(result.data)
    notify.success(
      result.data.purged != null
        ? `Listo. Se quitaron ${result.data.purged} alertas históricas.`
        : 'Listo. Alertas desde ahora.',
    )
  }

  if (loadFailed) {
    return <p className="text-muted">No se pudo cargar el SLA.</p>
  }
  if (!settings) {
    return <p className="text-muted">Cargando…</p>
  }

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
      <ModulePageHeader
        title="SLA primera respuesta"
        description="Meta y horario hábil para medir la primera respuesta humana en Educación. Independiente de Fuera de horario."
      />

      <div className="rounded-lg border border-line bg-surface px-3 py-2 text-sm space-y-1">
        <p>
          <span className="text-muted">Resumen: </span>
          <span className="font-medium text-ink">{summary}</span>
        </p>
        <p className="text-muted">
          Alertas de “sin atender” solo para leads iniciados desde{' '}
          <strong className="text-ink">
            {settings.alerts_since
              ? new Date(settings.alerts_since).toLocaleString('es-PE')
              : 'la próxima ejecución del job (se fijará sola)'}
          </strong>
          .
        </p>
      </div>

      <label className="block max-w-xs text-sm">
        <span className="font-medium">Meta (minutos hábiles)</span>
        <input
          type="number"
          min={minTarget}
          max={maxTarget}
          className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2"
          value={targetMinutes}
          onChange={(e) => setTargetMinutes(Number(e.target.value))}
        />
        <p className="mt-1 text-xs text-muted">
          Entre {minTarget} y {maxTarget}. Zona: {timezone} (fija).
        </p>
      </label>

      <fieldset className="space-y-3 border-0 p-0">
        <legend className="text-sm font-medium">Horario hábil por día</legend>
        <p className="text-sm text-muted">
          Solo en estos intervalos corre el reloj del SLA. Días sin marcar = cerrados.
        </p>
        <ul className="space-y-2">
          {DAY_LABELS.map((label, day) => {
            const on = enabledDays.has(day)
            const win = windows[day] ?? { from: '09:00', to: '18:00' }
            return (
              <li
                key={day}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              >
                <label className="flex min-h-11 min-w-[4.5rem] items-center gap-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => toggleDay(day)}
                  />
                  {label}
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-muted">Desde</span>
                  <input
                    type="time"
                    disabled={!on}
                    className="rounded-lg border border-line bg-surface px-2 py-1 disabled:opacity-50"
                    value={win.from}
                    onChange={(e) =>
                      setWindows((prev) => ({
                        ...prev,
                        [day]: { ...prev[day], from: e.target.value },
                      }))
                    }
                  />
                </label>
                <label className="flex items-center gap-1">
                  <span className="text-muted">Hasta</span>
                  <input
                    type="time"
                    disabled={!on}
                    className="rounded-lg border border-line bg-surface px-2 py-1 disabled:opacity-50"
                    value={win.to}
                    onChange={(e) =>
                      setWindows((prev) => ({
                        ...prev,
                        [day]: { ...prev[day], to: e.target.value },
                      }))
                    }
                  />
                </label>
              </li>
            )
          })}
        </ul>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="min-h-11 rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
          disabled={busy}
          onClick={() => void handleSave()}
        >
          {busy ? 'Guardando…' : 'Guardar SLA'}
        </button>
        <button
          type="button"
          className="small-btn secondary min-h-11"
          disabled={busy}
          onClick={() => handleResetDefaults()}
        >
          Restaurar valores por defecto
        </button>
        <button
          type="button"
          className="small-btn secondary min-h-11"
          disabled={busy}
          onClick={() => void handleStartFromNow()}
        >
          Empezar alertas desde ahora
        </button>
      </div>
    </section>
  )
}
