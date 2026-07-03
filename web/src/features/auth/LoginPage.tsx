import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)

  const from =
    (location.state as { from?: string } | null)?.from?.toString() || '/'

  useEffect(() => {
    apiClient.getMe().then((result) => {
      if (result.ok) navigate(from, { replace: true })
      else setChecking(false)
    })
  }, [from, navigate])

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setLoading(true)
    const result = await apiClient.login(email, password)
    setLoading(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate(from, { replace: true })
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
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface-strong p-6 shadow-sm"
      >
        <div>
          <h1 className="text-xl font-semibold">MALI WhatsApp</h1>
          <p className="text-sm text-muted">Inicia sesión con tu cuenta @mali.pe</p>
        </div>
        <label className="block space-y-1 text-sm">
          <span>Correo</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2"
            autoComplete="username"
            required
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>Contraseña</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2"
            autoComplete="current-password"
            required
          />
        </label>
        {error ? <p className="text-sm text-bad">{error}</p> : null}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-60"
        >
          {loading ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  )
}
