import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { ModulePageHeader } from '@/shared/ui/ModulePageHeader'

type AdminRolesCatalog = {
  readonly: true
  note: string
  groups: {
    id: string
    label: string
    permissions: { code: string; label: string }[]
  }[]
  roles: {
    slug: string
    label: string
    permission_codes: string[]
  }[]
}

export function AdminRolesPage() {
  const [catalog, setCatalog] = useState<AdminRolesCatalog | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null)
  const [permQuery, setPermQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [showCodes, setShowCodes] = useState(false)

  useEffect(() => {
    void apiClient.get<AdminRolesCatalog>('/api/admin/roles').then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        setLoadFailed(true)
        return
      }
      setCatalog(result.data)
      setSelectedSlug(result.data.roles[0]?.slug ?? null)
      const initial: Record<string, boolean> = {}
      for (const group of result.data.groups) initial[group.id] = false
      setCollapsed(initial)
    })
  }, [])

  const selected = useMemo(
    () => catalog?.roles.find((r) => r.slug === selectedSlug) ?? null,
    [catalog, selectedSlug],
  )

  const granted = useMemo(
    () => new Set(selected?.permission_codes ?? []),
    [selected],
  )

  const q = permQuery.trim().toLowerCase()

  if (loadFailed) {
    return <p className="text-muted">No se pudo cargar el catálogo de roles.</p>
  }

  if (!catalog) {
    return <p className="text-muted">Cargando roles…</p>
  }

  return (
    <div className="space-y-4">
      <ModulePageHeader
        title="Roles"
        description={catalog.note}
      />

      <div className="flex flex-wrap gap-2">
        {catalog.roles.map((role) => {
          const active = role.slug === selectedSlug
          return (
            <button
              key={role.slug}
              type="button"
              onClick={() => setSelectedSlug(role.slug)}
              className={`min-h-11 rounded-lg border px-3 py-1.5 text-sm ${
                active
                  ? 'border-accent bg-accent/10 text-ink'
                  : 'border-line text-muted hover:bg-surface-strong'
              }`}
            >
              {role.label}
            </button>
          )
        })}
      </div>

      {selected ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm">
              <strong>{selected.label}</strong>
              {' · '}
              <span className="text-muted">
                {selected.permission_codes.length} permisos
              </span>
            </p>
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={showCodes}
                onChange={(e) => setShowCodes(e.target.checked)}
              />
              Mostrar códigos
            </label>
          </div>

          <label className="block text-sm">
            <span className="sr-only">Buscar permiso</span>
            <input
              type="search"
              className="w-full max-w-md rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              placeholder="Buscar permiso…"
              value={permQuery}
              onChange={(e) => setPermQuery(e.target.value)}
            />
          </label>

          {catalog.groups.map((group) => {
            const perms = group.permissions.filter((perm) => {
              if (!q) return true
              return (
                perm.label.toLowerCase().includes(q) ||
                perm.code.toLowerCase().includes(q)
              )
            })
            if (perms.length === 0) return null
            const isCollapsed = collapsed[group.id] && !q
            const grantedCount = perms.filter((p) => granted.has(p.code)).length
            return (
              <section
                key={group.id}
                className="rounded-xl border border-line bg-surface-strong p-3"
              >
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium"
                  onClick={() =>
                    setCollapsed((prev) => ({
                      ...prev,
                      [group.id]: !prev[group.id],
                    }))
                  }
                  aria-expanded={!isCollapsed}
                >
                  <span>
                    {group.label}{' '}
                    <span className="font-normal text-muted">
                      ({grantedCount}/{perms.length})
                    </span>
                  </span>
                  <span className="text-muted" aria-hidden>
                    {isCollapsed ? '+' : '−'}
                  </span>
                </button>
                {!isCollapsed ? (
                  <ul className="mt-2 space-y-1.5">
                    {perms.map((perm) => {
                      const on = granted.has(perm.code)
                      return (
                        <li
                          key={perm.code}
                          className={`flex items-start gap-2 text-sm ${
                            on ? 'text-ink' : 'text-muted'
                          }`}
                        >
                          <span className="mt-0.5 w-4 shrink-0" aria-hidden>
                            {on ? '✓' : '·'}
                          </span>
                          <span>
                            {perm.label}
                            {showCodes ? (
                              <>
                                <br />
                                <code className="text-xs opacity-70">{perm.code}</code>
                              </>
                            ) : null}
                          </span>
                        </li>
                      )
                    })}
                  </ul>
                ) : null}
              </section>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
