import { useEffect, useMemo, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'

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

  useEffect(() => {
    void apiClient.get<AdminRolesCatalog>('/api/admin/roles').then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        setLoadFailed(true)
        return
      }
      setCatalog(result.data)
      setSelectedSlug(result.data.roles[0]?.slug ?? null)
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

  if (loadFailed) {
    return <p className="text-muted">No se pudo cargar</p>
  }

  if (!catalog) {
    return <p className="text-muted">Cargando roles…</p>
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{catalog.note}</p>

      <div className="flex flex-wrap gap-2">
        {catalog.roles.map((role) => {
          const active = role.slug === selectedSlug
          return (
            <button
              key={role.slug}
              type="button"
              onClick={() => setSelectedSlug(role.slug)}
              className={`rounded-lg border px-3 py-1.5 text-sm ${
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
          <p className="text-sm">
            <strong>{selected.label}</strong>{' '}
            <code className="text-xs text-muted">({selected.slug})</code>
            {' · '}
            <span className="text-muted">
              {selected.permission_codes.length} permisos
            </span>
          </p>

          {catalog.groups.map((group) => (
            <section
              key={group.id}
              className="rounded-xl border border-line p-3"
            >
              <h2 className="mb-2 text-sm font-medium">{group.label}</h2>
              <ul className="space-y-1.5">
                {group.permissions.map((perm) => {
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
                        <br />
                        <code className="text-xs opacity-70">{perm.code}</code>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </div>
  )
}
