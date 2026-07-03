import { useEffect, useState } from 'react'
import './App.css'

const TOKEN_KEY = 'mali_v2_token'

type AuthUser = {
  id: number
  email: string
  area: string
  allowedAreas: string[]
  isMaster: boolean
}

type MeResponse =
  | { ok: true; data: AuthUser }
  | { ok: false; error: string }

async function fetchMe(token?: string): Promise<MeResponse> {
  const headers: HeadersInit = {}
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch('/api/me', { headers })
  return res.json()
}

function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY) ?? undefined
    fetchMe(token)
      .then((json) => {
        if (json.ok) setUser(json.data)
      })
      .finally(() => setLoading(false))
  }, [])

  async function onLogin(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
    const json = await res.json()
    if (!res.ok || !json.ok) {
      setError(json.error || json.message || 'No se pudo iniciar sesión')
      return
    }
    const data = json.data as { accessToken: string; user: AuthUser }
    if (data.accessToken !== 'dev') {
      localStorage.setItem(TOKEN_KEY, data.accessToken)
    }
    setUser(data.user)
  }

  function onLogout() {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
  }

  return (
    <main className="app">
      <h1>MALI WhatsApp v2</h1>

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
