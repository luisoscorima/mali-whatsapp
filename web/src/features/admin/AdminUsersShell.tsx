import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/shared/api'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { AdminUserFormSheet } from './AdminUserFormSheet'
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

export function AdminUsersShell() {
  const [users, setUsers] = useState<AdminUserListItem[] | null>(null)
  const [online, setOnline] = useState<AdminOnlineUsersResult | null>(null)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [sheetMode, setSheetMode] = useState<'create' | 'edit'>('create')
  const [sheetUserId, setSheetUserId] = useState<number | null>(null)

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

  function openCreate() {
    setSheetMode('create')
    setSheetUserId(null)
    setSheetOpen(true)
  }

  function openEdit(userId: number) {
    setSheetMode('edit')
    setSheetUserId(userId)
    setSheetOpen(true)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Gestiona usuarios, áreas y permisos. El punto verde indica actividad reciente.
        </p>
        <button type="button" className="small-btn primary shrink-0" onClick={openCreate}>
          Nuevo
        </button>
      </div>

      {!users ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted">No hay usuarios.</p>
      ) : (
        <ul className="inbox-chat-list rounded-xl border border-line">
          {users.map((user) => {
            const isOnline = onlineEmails.has(user.email.toLowerCase())
            return (
              <li key={user.id} className="inbox-chat-item">
                <button
                  type="button"
                  className="inbox-chat-link w-full text-left"
                  onClick={() => openEdit(user.id)}
                >
                  <span className="inbox-chat-link-main">
                    <span className="inbox-chat-row-top">
                      <span className="inbox-chat-title">
                        {isOnline ? (
                          <span
                            className="admin-online-dot mr-1.5 inline-block"
                            title="En línea"
                            aria-label="En línea"
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
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <AdminUserFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        mode={sheetMode}
        userId={sheetUserId}
        onSaved={load}
      />
    </div>
  )
}
