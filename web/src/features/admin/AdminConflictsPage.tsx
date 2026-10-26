import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { InboxListPager } from '@/shared/ui/InboxListPager'

type Ficha = {
  id: number
  kept: boolean
  name: string
  area: string
  email: string | null
  dni: string | null
  whatsapp_user_id: string | null
  status: string | null
  advisor: string | null
}

type PhoneGroup = {
  phone: string
  why: string[]
  fichas: Ficha[]
}

type IdentityConflict = {
  id: number
  person_name: string
  reason: string
  stored_phone: string | null
  stored_dni: string | null
  stored_email: string | null
  phone: string | null
  dni: string | null
  email: string | null
}

type ConflictLists = {
  page: number
  page_size: number
  phone_pending: number
  phone_done: number
  phones: PhoneGroup[]
  identity: IdentityConflict[]
}

function detail(ficha: Ficha): string {
  return [
    ficha.area,
    ficha.email,
    ficha.dni ? `DNI ${ficha.dni}` : '',
    ficha.status,
    ficha.advisor ? `Asesor ${ficha.advisor}` : '',
  ].filter(Boolean).join(' · ')
}

export function AdminConflictsPage() {
  const [page, setPage] = useState(1)
  const [reload, setReload] = useState(0)
  const [data, setData] = useState<ConflictLists | null>(null)

  useEffect(() => {
    void apiClient.get<ConflictLists>(`/api/admin/conflicts?page=${page}`).then((result) => {
      if (!result.ok) {
        notify.error(result.error)
        return
      }
      setData(result.data)
      if (result.data.page !== page) setPage(result.data.page)
    })
  }, [page, reload])

  if (!data) return <p className="text-muted">Cargando conflictos…</p>

  const totalPages = Math.max(1, Math.ceil(data.phone_pending / data.page_size))

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Mismo teléfono, varias fichas</h2>
        <p className="text-sm text-muted">
          Quedan {data.phone_pending}. Ya dejaste {data.phone_done} separadas.
          Pasa de página para ver los demás. No se unieron solas porque los datos de abajo no coinciden. Si no son la misma persona, déjalas separadas.
        </p>
        {data.phones.map((group) => (
          <article key={group.phone} className="space-y-2 rounded-xl border border-line p-3 text-sm">
            <p className="font-medium">{group.phone}</p>
            <p className="text-muted">{group.why.join('. ')}</p>
            <ul className="space-y-2">
              {group.fichas.map((ficha) => (
                <li key={ficha.id}>
                  <p>
                    {ficha.name}
                    <span className="text-muted">
                      {' '}· {ficha.kept ? 'se habría conservado' : 'no se unió'}
                    </span>
                  </p>
                  <p className="text-muted">{detail(ficha)}</p>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="small-btn secondary"
              onClick={() => {
                void apiClient
                  .post('/api/admin/conflicts/consolidation/phone/separate', { phone: group.phone })
                  .then((result) => {
                    if (!result.ok) {
                      notify.error(result.error)
                      return
                    }
                    notify.success('Quedaron separadas')
                    setReload((current) => current + 1)
                  })
              }}
            >
              Dejar separadas
            </button>
          </article>
        ))}
        {data.phones.length === 0 ? <p className="text-sm text-muted">No hay teléfonos pendientes.</p> : null}
        <InboxListPager
          page={data.page}
          totalPages={totalPages}
          onPageChange={setPage}
          ariaLabel="Paginación de teléfonos en revisión"
        />
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-medium">Dato que no coincide con la persona ({data.identity.length})</h2>
        <p className="text-sm text-muted">
          La persona ya existe. El dato nuevo no coincidió y no se creó otra.
        </p>
        {data.identity.map((row) => (
          <article key={row.id} className="space-y-1 rounded-xl border border-line p-3 text-sm">
            <p className="font-medium">{row.person_name}</p>
            <p>{row.reason}</p>
            <p className="text-muted">
              Guardado: {[row.stored_phone, row.stored_dni ? `DNI ${row.stored_dni}` : '', row.stored_email].filter(Boolean).join(' · ') || 'sin datos'}
            </p>
            <p className="text-muted">
              Llegó: {[row.phone, row.dni ? `DNI ${row.dni}` : '', row.email].filter(Boolean).join(' · ') || 'sin datos'}
            </p>
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
                    notify.success('Quedó como está')
                    setReload((current) => current + 1)
                  })
              }}
            >
              Dejar la persona como está
            </button>
          </article>
        ))}
        {data.identity.length === 0 ? <p className="text-sm text-muted">No hay datos en conflicto.</p> : null}
      </section>
    </div>
  )
}
