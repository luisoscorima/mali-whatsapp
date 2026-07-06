import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { useIntervalWhenVisible } from '@/shared/hooks/useIntervalWhenVisible'
import { WaEmptyPane } from '@/shared/ui/shell/WaEmptyPane'

const ONLINE_POLL_MS = 20_000

type AdminOnlineUsersResult = {
  users: { email: string }[]
  idle_minutes: number
}

export function AdminUsersEmptyPane() {
  const [online, setOnline] = useState<AdminOnlineUsersResult | null>(null)

  function load() {
    void apiClient.get<AdminOnlineUsersResult>('/api/admin/online-users').then((result) => {
      if (result.ok) setOnline(result.data)
    })
  }

  useEffect(() => {
    load()
  }, [])

  useIntervalWhenVisible(load, ONLINE_POLL_MS)

  const idleMinutes = online?.idle_minutes ?? 5
  const onlineCount = online?.users.length ?? 0

  return (
    <WaEmptyPane heading="Usuarios" text="Selecciona un usuario de la lista o crea uno nuevo.">
      <section className="mt-4 rounded-xl border border-line bg-surface-strong p-4 text-left">
        <h3 className="text-sm font-semibold">En línea ahora</h3>
        <p className="mt-1 text-xs text-muted">
          Actividad en los últimos {idleMinutes} minutos.
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
    </WaEmptyPane>
  )
}
