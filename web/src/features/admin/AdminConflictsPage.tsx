import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'

type ConflictLists = {
  consolidation: { contact_id: number; phone_norm: string; canonical_id: number }[]
  identity: {
    id: number
    person_id: number
    reason: string
    phone: string | null
    dni: string | null
    email: string | null
  }[]
}

export function AdminConflictsPage() {
  const [data, setData] = useState<ConflictLists | null>(null)

  function load() {
    void apiClient.get<ConflictLists>('/api/admin/conflicts').then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        return
      }
      setData(result.data)
    })
  }

  useEffect(() => {
    load()
  }, [])

  if (!data) return <p className="text-muted">Cargando conflictos…</p>

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted">
        Cada fila se decide a mano. Dejar separados no fusiona fichas ni abre una segunda persona.
      </p>
      <section>
        <h2 className="text-sm font-medium">Teléfonos en revisión ({data.consolidation.length})</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {data.consolidation.map((row) => (
            <li key={row.contact_id} className="flex flex-wrap items-center gap-2">
              <span>
                {row.phone_norm} · ficha {row.contact_id} · canónica {row.canonical_id}
              </span>
              <button
                type="button"
                className="small-btn secondary"
                onClick={() => {
                  void apiClient
                    .post(`/api/admin/conflicts/consolidation/${row.contact_id}/separate`, {})
                    .then((result) => {
                      if (!result.ok) {
                        notify.error(result.error)
                        return
                      }
                      notify.success('Quedaron separados')
                      load()
                    })
                }}
              >
                Dejar separados
              </button>
            </li>
          ))}
          {data.consolidation.length === 0 ? <li className="text-muted">No hay teléfonos en revisión.</li> : null}
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-medium">Identidad en conflicto ({data.identity.length})</h2>
        <ul className="mt-2 space-y-2 text-sm">
          {data.identity.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center gap-2">
              <span>
                Persona {row.person_id} · {row.reason}
                {row.phone ? ` · ${row.phone}` : ''}
                {row.dni ? ` · DNI ${row.dni}` : ''}
                {row.email ? ` · ${row.email}` : ''}
              </span>
              <button
                type="button"
                className="small-btn secondary"
                onClick={() => {
                  void apiClient
                    .post(`/api/admin/conflicts/identity/${row.id}/resolve`, {})
                    .then((result) => {
                      if (!result.ok) {
                        notify.error(result.error)
                        return
                      }
                      notify.success('Conflicto cerrado sin fusionar')
                      load()
                    })
                }}
              >
                Dejar la persona como está
              </button>
            </li>
          ))}
          {data.identity.length === 0 ? <li className="text-muted">No hay conflictos de identidad.</li> : null}
        </ul>
      </section>
    </div>
  )
}
