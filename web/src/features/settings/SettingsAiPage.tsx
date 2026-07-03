import { useEffect, useState } from 'react'
import { apiClient } from '../../shared/api'

type AiSettings = {
  area: string
  enabled: boolean
  prompt: string
  transfer_keyword: string
  can_toggle_enabled: boolean
}

export function SettingsAiPage() {
  const [settings, setSettings] = useState<AiSettings | null>(null)
  const [prompt, setPrompt] = useState('')
  const [transferKeyword, setTransferKeyword] = useState('[TRANSFERIR]')
  const [enabled, setEnabled] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState('')

  async function load() {
    setLoadError('')
    const result = await apiClient.get<AiSettings>('/api/settings/ai')
    if (!result.ok) {
      setLoadError(result.error)
      return
    }
    setSettings(result.data)
    setPrompt(result.data.prompt)
    setTransferKeyword(result.data.transfer_keyword || '[TRANSFERIR]')
    setEnabled(result.data.enabled)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleToggleEnabled(next: boolean) {
    if (!settings?.can_toggle_enabled) return
    setBusy('toggle')
    setStatus('')
    const result = await apiClient.post(`/api/settings/ai/${settings.area}/enable`, {
      enabled: next,
    })
    setBusy('')
    if (!result.ok) {
      setStatus(result.error)
      return
    }
    setEnabled(next)
    setStatus(next ? 'IA activada para el área.' : 'IA desactivada; chats en modo asesor.')
  }

  async function handleSave() {
    if (!settings) return
    const trimmed = prompt.trim()
    if (!trimmed) {
      setStatus('El prompt no puede estar vacío.')
      return
    }
    setBusy('save')
    setStatus('Guardando…')
    const result = await apiClient.patch(`/api/settings/ai/${settings.area}`, {
      enabled,
      prompt: trimmed,
      transfer_keyword: transferKeyword.trim() || '[TRANSFERIR]',
    })
    setBusy('')
    if (!result.ok) {
      setStatus(result.error)
      return
    }
    setStatus('Guardado.')
    setTimeout(() => setStatus(''), 4000)
  }

  if (loadError) {
    return <p className="text-bad">{loadError}</p>
  }

  if (!settings) {
    return <p className="text-muted">Cargando…</p>
  }

  return (
    <section className="space-y-4 rounded-xl border border-line bg-surface-strong p-4">
      <h2 className="text-lg font-semibold">
        Respuesta automática (IA) · {settings.area}
      </h2>

      {settings.can_toggle_enabled ? (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            Solo administrador master. Al desactivar, todos los chats del área pasan
            a modo asesor. Al activar, vuelven a bot.
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              disabled={busy !== ''}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
            />
            IA habilitada para el área
          </label>
        </div>
      ) : null}

      <div className="space-y-3 border-t border-line pt-4">
        <label className="block text-sm">
          <span className="font-medium">Instrucciones del modelo (system prompt)</span>
          <p className="mt-1 text-xs text-muted">
            Comportamiento del asistente en esta área (respuestas automáticas vía Groq).
          </p>
          <textarea
            className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            rows={10}
            maxLength={32000}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Instrucciones en español para el modelo…"
          />
        </label>

        <label className="block text-sm">
          <span className="font-medium">Palabra clave de transferencia a asesor</span>
          <input
            type="text"
            className="mt-1 w-full max-w-md rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            maxLength={200}
            value={transferKeyword}
            onChange={(e) => setTransferKeyword(e.target.value)}
          />
          <p className="mt-1 text-xs text-muted">
            Si la respuesta contiene exactamente este texto, el chat pasa a asesor sin
            enviar mensaje al cliente.
          </p>
        </label>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white hover:opacity-90 disabled:opacity-50"
            disabled={busy !== ''}
            onClick={() => handleSave()}
          >
            {busy === 'save' ? 'Guardando…' : 'Guardar instrucciones'}
          </button>
          {status ? <span className="text-sm text-muted">{status}</span> : null}
        </div>
      </div>
    </section>
  )
}
