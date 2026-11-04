import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/shared/api'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { ModulePageHeader } from '@/shared/ui/ModulePageHeader'
import { AdminUserFormSheet } from './AdminUserFormSheet'
import { canonicalArea } from '@/shared/area/category-selection'
import { areaLabel } from './areaLabels'
import { ROLE_OPTIONS } from '@/shared/auth/permissions'

const ONLINE_POLL_MS = 20_000

type AdminUserListItem = {
  id: number
  email: string
  area: string
  role_slug: string | null
  is_master: boolean
}

type AdminOnlineUsersResult = {
  users: { email: string }[]
}

export function AdminUsersShell() {
  const [users, setUsers] = useState<AdminUserListItem[] | null>(null)
  const [online, setOnline] = useState<AdminOnlineUsersResult | null>(null)
  const [query, setQuery] = useState('')
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

  const filtered = useMemo(() => {
    if (!users) return null
    const q = query.trim().toLowerCase()
    if (!q) return users
    return users.filter((user) => {
      const roleLabel =
        ROLE_OPTIONS.find((r) => r.slug === user.role_slug)?.label ?? user.role_slug ?? ''
      return (
        user.email.toLowerCase().includes(q) ||
        areaLabel(canonicalArea(user.area)).toLowerCase().includes(q) ||
        roleLabel.toLowerCase().includes(q)
      )
    })
  }, [users, query])

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
      <ModulePageHeader
        title="Usuarios"
        description="Gestiona usuarios, áreas y roles. El indicador verde marca actividad reciente."
        actions={
          <button type="button" className="small-btn primary shrink-0 min-h-11" onClick={openCreate}>
            Nuevo
          </button>
        }
      />

      <label className="block text-sm">
        <span className="sr-only">Buscar usuarios</span>
        <input
          type="search"
          className="w-full max-w-md rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          placeholder="Buscar por email, área o rol…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      {!filtered ? (
        <p className="text-sm text-muted">Cargando…</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-line bg-surface-strong p-4 text-sm text-muted">
          {users && users.length === 0 ? (
            <p>
              No hay usuarios.{' '}
              <button type="button" className="text-accent underline" onClick={openCreate}>
                Crear el primero
              </button>
            </p>
          ) : (
            <p>Ningún usuario coincide con la búsqueda.</p>
          )}
        </div>
      ) : (
        <ul className="inbox-chat-list rounded-xl border border-line">
          {filtered.map((user) => {
            const isOnline = onlineEmails.has(user.email.toLowerCase())
            const roleLabel = user.role_slug
              ? ROLE_OPTIONS.find((r) => r.slug === user.role_slug)?.label ?? user.role_slug
              : null
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
                        {isOnline ? (
                          <span className="ml-2 text-xs font-normal text-muted">En línea</span>
                        ) : null}
                      </span>
                    </span>
                    <span className="mt-1 flex flex-wrap gap-1">
                      <span className="area-pill area-pill--menu">
                        {areaLabel(canonicalArea(user.area))}
                      </span>
                      {roleLabel ? (
                        <span className="area-pill area-pill--menu">{roleLabel}</span>
                      ) : null}
                      {user.is_master ? (
                        <span className="area-pill area-pill--master area-pill--menu">Master</span>
                      ) : null}
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
