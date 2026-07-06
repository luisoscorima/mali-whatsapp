import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [googleEnabled, setGoogleEnabled] = useState(false)

  const from =
    (location.state as { from?: string } | null)?.from?.toString() || '/'

  useEffect(() => {
    const oauthError = searchParams.get('error')
    if (oauthError) {
      setError(decodeURIComponent(oauthError))
    }
  }, [searchParams])

  useEffect(() => {
    apiClient.getAuthConfig().then((config) => {
      if (config.ok) {
        setGoogleEnabled(config.data.googleEnabled)
      }
    })
    apiClient.getMe({ sessionProbe: true }).then((result) => {
      if (result.ok) {
        navigate(from, { replace: true })
      } else {
        setChecking(false)
      }
    })
  }, [from, navigate])

  if (checking) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Cargando…
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm space-y-4 rounded-xl border border-line bg-surface-strong p-6 shadow-sm">
        <div>
          <h1 className="text-xl font-semibold">MALI WhatsApp</h1>
          <p className="text-sm text-muted">
            Acceso exclusivo para cuentas <strong>@mali.pe</strong>
          </p>
        </div>
        {googleEnabled ? (
          <button
            type="button"
            onClick={() => {
              window.location.href = '/api/auth/google'
            }}
            className="w-full rounded-lg bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Continuar con Google
          </button>
        ) : (
          <p className="text-sm text-bad">
            Google OAuth no está configurado en el servidor.
          </p>
        )}
        {error ? <p className="text-sm text-bad">{error}</p> : null}
      </div>
    </div>
  )
}
