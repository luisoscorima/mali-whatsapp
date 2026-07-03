import { useEffect, useState } from 'react'
import { apiClient, onUnauthorized, type AuthUser } from './shared/api'
import './App.css'

function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [health, setHealth] = useState<string | null>(null)

  useEffect(() => {
    onUnauthorized(() => {
      setUser(null)
      setHealth(null)
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    async function loadSession() {
      const [meResult, healthResult] = await Promise.all([
        apiClient.getMe(),
        apiClient.getHealth(),
      ])

      if (cancelled) return

      if (meResult.ok) {
        setUser(meResult.data)
      } else {
        setUser(null)
      }

      setHealth(
        healthResult.ok
          ? `API ${healthResult.db === 'up' ? 'conectada a BD' : 'activa'}`
          : healthResult.error || 'API no disponible',
      )
      setLoading(false)
    }

    loadSession()
    return () => {
      cancelled = true
    }
  }, [])

  async function onLogin(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    const result = await apiClient.login(email, password)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setUser(result.data.user)
    const healthResult = await apiClient.getHealth()
    setHealth(
      healthResult.ok
        ? `API ${healthResult.db === 'up' ? 'conectada a BD' : 'activa'}`
        : healthResult.error || 'API no disponible',
    )
  }

  function onLogout() {
    apiClient.logout()
    setUser(null)
    setHealth(null)
  }

  return (
    <main className="app">
      <h1>MALI WhatsApp v2</h1>

      {health ? <p className="muted">{health}</p> : null}

      {loading ? (
        <p className="muted">Cargando sesión…</p>
      ) : user ? (
        <section className="session">
          <p>
            Sesión: <strong>{user.email}</strong> · área <strong>{user.area}</strong>
            {user.isMaster ? ' · master' : ''}
          </p>
          <button type="button" onClick={onLogout}>
            Cerrar sesión
          </button>
        </section>
      ) : (
        <form className="login" onSubmit={onLogin}>
          <p className="muted">Inicia sesión con tu cuenta @mali.pe</p>
          <label>
            Correo
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            Contraseña
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">Entrar</button>
        </form>
      )}
    </main>
  )
}

export default App
