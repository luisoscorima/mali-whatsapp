import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { areaLabel } from './areaLabels'

const ONLINE_POLL_MS = 20_000

type AdminUserListItem = {
  id: number
  email: string
  area: string
  is_master: boolean
  must_change_password: boolean
  created_at: string
}

type AdminOnlineUsersResult = {
  users: { email: string }[]
  idle_minutes: number
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserListItem[] | null>(null)
  const [online, setOnline] = useState<AdminOnlineUsersResult | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  function load() {
    apiClient.get<AdminUserListItem[]>('/api/admin/users').then((result) => {
      if (!result.ok) {
        setError(result.error)
        return
      }
      setUsers(result.data)
    })
  }

  function loadOnline() {
    apiClient.get<AdminOnlineUsersResult>('/api/admin/online-users').then((result) => {
      if (!result.ok) return
      setOnline(result.data)
    })
  }

  useEffect(() => {
    load()
    loadOnline()
    const timer = window.setInterval(loadOnline, ONLINE_POLL_MS)
    return () => window.clearInterval(timer)
  }, [])

  const onlineEmails = useMemo(
    () => new Set((online?.users ?? []).map((u) => u.email.toLowerCase())),
    [online?.users],
  )

  async function onDelete(id: number, email: string) {
    if (!window.confirm(`¿Eliminar ${email}?`)) return
    const result = await apiClient.delete(`/api/admin/users/${id}`)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setMessage('Usuario eliminado')
    load()
  }

  if (error) return <p className="text-bad">{error}</p>
  if (!users) return <p className="text-muted">Cargando usuarios…</p>

  const idleMinutes = online?.idle_minutes ?? 5
  const onlineCount = online?.users.length ?? 0

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Usuarios</h2>
        <Link
          to="/admin/users/new"
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
        >
          Nuevo usuario
        </Link>
      </div>

      <section className="rounded-xl border border-line bg-surface-strong p-4">
        <h3 className="text-sm font-semibold">En línea ahora</h3>
        <p className="mt-1 text-xs text-muted">
          Actividad en los últimos {idleMinutes} minutos. Se actualiza solo cada{' '}
          {ONLINE_POLL_MS / 1000}s.
        </p>
        <p className="admin-online-status mt-2 text-sm text-muted" aria-live="polite">
          {onlineCount === 0
            ? 'Nadie en línea en este momento.'
            : onlineCount === 1
              ? '1 usuario en línea.'
              : `${onlineCount} usuarios en línea.`}
        </p>
        {onlineCount > 0 ? (
          <ul className="admin-online-list mt-2" aria-label="Correos en línea">
            {online!.users.map((row) => (
              <li key={row.email} className="admin-online-list__item">
                <span className="admin-online-dot" aria-hidden="true" />
                <span className="admin-online-list__email">{row.email}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {message ? <p className="text-sm text-accent">{message}</p> : null}
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="min-w-full text-sm">
          <thead className="border-b border-line bg-surface-strong/50 text-left">
            <tr>
              <th className="px-3 py-2">Correo</th>
              <th className="px-3 py-2">Área</th>
              <th className="px-3 py-2">Rol</th>
              <th className="px-3 py-2">Creado</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isOnline = onlineEmails.has(user.email.toLowerCase())
              return (
                <tr key={user.id} className="border-b border-line last:border-0">
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-2">
                      {isOnline ? (
                        <span
                          className="admin-online-dot"
                          title="En línea"
                          aria-label="En línea"
                        />
                      ) : null}
                      {user.email}
                    </span>
                  </td>
                  <td className="px-3 py-2">{areaLabel(user.area)}</td>
                  <td className="px-3 py-2">
                    {user.is_master ? 'Master' : 'Usuario'}
                    {user.must_change_password ? ' · cambio pwd' : ''}
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {formatDateTime(user.created_at)}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Link to={`/admin/users/${user.id}`} className="text-accent underline">
                      Editar
                    </Link>
                    {' · '}
                    <button
                      type="button"
                      className="text-bad underline"
                      onClick={() => void onDelete(user.id, user.email)}
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
