import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { formatDateTime } from '../../shared/format'
import { areaLabel } from './areaLabels'

type AdminUserListItem = {
  id: number
  email: string
  area: string
  is_master: boolean
  must_change_password: boolean
  created_at: string
}

export function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUserListItem[] | null>(null)
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

  useEffect(() => {
    load()
  }, [])

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
            {users.map((user) => (
              <tr key={user.id} className="border-b border-line last:border-0">
                <td className="px-3 py-2">{user.email}</td>
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
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
