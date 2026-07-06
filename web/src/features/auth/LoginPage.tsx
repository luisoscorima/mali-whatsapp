import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { MALI_LOGO_URL } from '@/shared/brand'
import { useTheme } from '@/shared/theme/useTheme'
import { apiClient } from '../../shared/api'
import { GoogleLogoIcon } from './GoogleLogoIcon'
import { WaveBackground } from './WaveBackground'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { toggleTheme } = useTheme()
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(true)
  const [googleEnabled, setGoogleEnabled] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  const from =
    (location.state as { from?: string } | null)?.from?.toString() || '/conversations'

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
    apiClient.getSession().then((result) => {
      if (result.ok && result.data.authenticated) {
        navigate(from, { replace: true })
      } else {
        setChecking(false)
      }
    })
  }, [from, navigate])

  function handleGoogleLogin() {
    if (redirecting) return
    setRedirecting(true)
    window.setTimeout(() => {
      window.location.href = '/api/auth/google'
    }, 600)
  }

  if (checking) {
    return (
      <div className="login-shell">
        <WaveBackground />
        <p className="login-loading">Cargando…</p>
      </div>
    )
  }

  return (
    <div className="login-shell">
      {redirecting ? (
        <div
          className="login-progress-track"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Conectando con Google"
        >
          <div className="login-progress-fill" />
        </div>
      ) : null}

      <WaveBackground />

      <button
        type="button"
        className="theme-toggle login-theme-toggle"
        onClick={toggleTheme}
        title="Modo claro / oscuro"
        aria-label="Cambiar tema"
      >
        ◐
      </button>

      <div className="login-page">
        <div className="login-stack">
          <div className="login-brand login-fade-up login-stagger-1">
            <div className="login-brand__logo-box">
              <img
                className="login-brand__logo-img"
                src={MALI_LOGO_URL}
                alt=""
                width={150}
                height={44}
                decoding="async"
              />
            </div>
            <div className="login-brand__text">
              <span className="login-brand__title">Whatsapp MALI</span>
              <span className="login-brand__subtitle">Museo de Arte de Lima</span>
            </div>
          </div>

          <div className="login-card login-card-enter login-card-interactive login-stagger-2">
            <h1 className="login-title">Bienvenido</h1>
            <p className="login-lead">
              Inicia sesión con tu cuenta <strong>@mali.pe</strong>
            </p>

            {error ? (
              <p className="login-error" role="alert">
                {error}
              </p>
            ) : null}

            {googleEnabled ? (
              <button
                type="button"
                className="login-google-btn"
                onClick={handleGoogleLogin}
                disabled={redirecting}
              >
                <span className="login-google-btn__shine" aria-hidden />
                {redirecting ? (
                  <span className="login-google-spinner" aria-hidden />
                ) : (
                  <GoogleLogoIcon className="login-google-icon" />
                )}
                {redirecting ? 'Conectando con Google…' : 'Continuar con Google'}
              </button>
            ) : (
              <p className="login-error" role="alert">
                Google OAuth no está configurado en el servidor.
              </p>
            )}

            <p className="login-footnote">
              Acceso exclusivo para el equipo del Museo de Arte de Lima
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
