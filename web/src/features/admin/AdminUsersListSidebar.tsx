import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { WaSidebar } from '@/shared/ui/shell/WaSidebar'
import { areaLabel } from './areaLabels'

const ONLINE_POLL_MS = 20_000

type AdminUserListItem = {
  id: number
  email: string
  area: string
  is_master: boolean
}

type AdminOnlineUsersResult = {
  users: { email: string }[]
}

type AdminUsersListSidebarProps = {
  selectedId?: number | null
}

export function AdminUsersListSidebar({ selectedId }: AdminUsersListSidebarProps) {
  const [users, setUsers] = useState<AdminUserListItem[] | null>(null)
  const [online, setOnline] = useState<AdminOnlineUsersResult | null>(null)

  function load() {
    void apiClient.get<AdminUserListItem[]>('/api/admin/users').then((result) => {
      if (result.ok) setUsers(result.data)
    })
    void apiClient.get<AdminOnlineUsersResult>('/api/admin/online-users').then((result) => {
      if (result.ok) setOnline(result.data)
    })
  }

  useEffect(() => {
    load()
  }, [])

  useIntervalWhenVisible(load, ONLINE_POLL_MS)

  const onlineEmails = useMemo(
    () => new Set((online?.users ?? []).map((u) => u.email.toLowerCase())),
    [online?.users],
  )

  return (
    <WaSidebar
      title="Usuarios"
      actions={
        <Link to="/admin/users/new" className="small-btn primary">
          Nuevo
        </Link>
      }
    >
      {!users ? (
        <p className="inbox-empty-list">Cargando…</p>
      ) : users.length === 0 ? (
        <p className="inbox-empty-list">No hay usuarios.</p>
      ) : (
        <ul className="inbox-chat-list">
          {users.map((user) => {
            const active = selectedId === user.id
            const isOnline = onlineEmails.has(user.email.toLowerCase())
            return (
              <li
                key={user.id}
                className={`inbox-chat-item ${active ? 'is-active' : ''}`}
              >
                <Link to={`/admin/users/${user.id}`} className="inbox-chat-link">
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-row-top">
                      <span className="inbox-chat-title">
                        {isOnline ? (
                          <span
                            className="admin-online-dot mr-1.5 inline-block"
                            title="En línea"
                            aria-hidden="true"
                          />
                        ) : null}
                        {user.email}
                      </span>
                    </span>
                    <span className="inbox-chat-preview">
                      {areaLabel(user.area)}
                      {user.is_master ? ' · Master' : ''}
                    </span>
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WaSidebar>
  )
}
