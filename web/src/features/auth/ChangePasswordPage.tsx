import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'

export function ChangePasswordPage() {
  const navigate = useNavigate()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    apiClient.getMe().then((result) => {
      if (!result.ok) {
        navigate('/login', { replace: true })
        return
      }
      if (!result.data.mustChangePassword) {
        navigate('/', { replace: true })
        return
      }
      setChecking(false)
    })
  }, [navigate])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    const result = await apiClient.changePassword({
      current_password: currentPassword,
      new_password: newPassword,
      confirm_password: confirmPassword,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate('/', { replace: true })
  }

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Cargando…
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <form
        onSubmit={(e) => void onSubmit(e)}
        className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface-strong p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">Nueva contraseña</h1>
          <p className="text-sm text-muted">
            Debes definir una contraseña propia antes de continuar.
          </p>
        </div>
        <label className="block space-y-1 text-sm">
          <span>Contraseña actual</span>
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2"
            autoComplete="current-password"
            required
            autoFocus
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Nueva contraseña</span>
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2"
            autoComplete="new-password"
            required
            minLength={6}
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Confirmar nueva contraseña</span>
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2"
            autoComplete="new-password"
            required
            minLength={6}
          />
        </label>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {busy ? 'Guardando…' : 'Guardar y continuar'}
        </button>
      </form>
    </div>
  )
}
