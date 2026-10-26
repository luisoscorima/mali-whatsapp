import { useEffect, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { InboxListPager } from '@/shared/ui/InboxListPager'

type Ficha = {
  id: number
  kept: boolean
  name: string
  first_name: string
  last_name: string
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
  stored_whatsapp_user_id: string | null
  phone: string | null
  dni: string | null
  email: string | null
  whatsapp_user_id: string | null
}

type ConflictLists = {
  page: number
  page_size: number
  phone_pending: number
  phone_done: number
  phone_joined: number
  phones: PhoneGroup[]
  identity: IdentityConflict[]
}

function arrivedText(row: IdentityConflict): string {
  return [
    row.phone,
    row.dni ? `DNI ${row.dni}` : '',
    row.email,
    row.whatsapp_user_id ? `WhatsApp ${row.whatsapp_user_id}` : '',
  ].filter(Boolean).join(' · ') || 'sin datos'
}

function IdentityConflictCard({ row, onDone }: { row: IdentityConflict; onDone: () => void }) {
  const [phone, setPhone] = useState(row.stored_phone ?? '')
  const [dni, setDni] = useState(row.stored_dni ?? '')
  const [email, setEmail] = useState(row.stored_email ?? '')
  const [whatsappUserId, setWhatsappUserId] = useState(row.stored_whatsapp_user_id ?? '')
  const [busy, setBusy] = useState(false)

  return (
    <article className="space-y-2 rounded-xl border border-line p-3 text-sm">
      <p className="font-medium">{row.person_name}</p>
      <p>{row.reason}</p>
      <p className="text-muted">Llegó esto: {arrivedText(row)}</p>
      <p className="text-muted">
        Los campos son lo que ya está guardado. Cámbialos solo si lo que llegó es de esta misma persona.
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          className="rounded-lg border border-line bg-surface px-3 py-2"
          value={phone}
          aria-label="Teléfono"
          placeholder="Teléfono"
          onChange={(event) => setPhone(event.target.value)}
        />
        <input
          className="rounded-lg border border-line bg-surface px-3 py-2"
          value={dni}
          aria-label="DNI"
          placeholder="DNI"
          onChange={(event) => setDni(event.target.value)}
        />
        <input
          className="rounded-lg border border-line bg-surface px-3 py-2"
          value={email}
          aria-label="Correo"
          placeholder="Correo"
          onChange={(event) => setEmail(event.target.value)}
        />
        <input
          className="rounded-lg border border-line bg-surface px-3 py-2"
          value={whatsappUserId}
          aria-label="Identidad de WhatsApp"
          placeholder="Identidad de WhatsApp"
          onChange={(event) => setWhatsappUserId(event.target.value)}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="small-btn"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void apiClient
              .post(`/api/admin/conflicts/identity/${row.id}/apply`, {
                phone,
                dni,
                email,
                whatsapp_user_id: whatsappUserId,
              })
              .then((result) => {
                setBusy(false)
                if (!result.ok) {
                  notify.error(result.error)
                  return
                }
                notify.success('Quedó guardado en esta persona')
                onDone()
              })
          }}
        >
          Guardar en esta persona
        </button>
        <button
          type="button"
          className="small-btn secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void apiClient
              .post(`/api/admin/conflicts/identity/${row.id}/resolve`, {})
              .then((result) => {
                setBusy(false)
                if (!result.ok) {
                  notify.error(result.error)
                  return
                }
                notify.success('Quedó como está')
                onDone()
              })
          }}
        >
          Dejar la persona como está
        </button>
      </div>
    </article>
  )
}

function PhoneConflictCard({ group, onDone }: { group: PhoneGroup; onDone: () => void }) {
  const kept = group.fichas.find((ficha) => ficha.kept) ?? null
  const [name, setName] = useState(kept?.first_name ?? '')
  const [lastName, setLastName] = useState(kept?.last_name ?? '')
  const [email, setEmail] = useState(kept?.email ?? '')
  const [dni, setDni] = useState(kept?.dni ?? '')
  const [busy, setBusy] = useState(false)

  function finish(message: string) {
    notify.success(message)
    onDone()
  }

  return (
    <article className="space-y-2 rounded-xl border border-line p-3 text-sm">
      <p className="font-medium">{group.phone}</p>
      <p className="text-muted">No se unió sola. {group.why.join(' ')}</p>
      <ul className="space-y-2">
        {group.fichas.map((ficha) => (
          <li key={ficha.id}>
            {ficha.kept && kept ? (
              <div className="space-y-2">
                <p className="text-muted">Esta ficha se queda. Escribe aquí el nombre, el DNI y el correo correctos.</p>
                <div className="flex flex-wrap gap-2">
                  <input
                    className="rounded-lg border border-line bg-surface px-3 py-2"
                    value={name}
                    aria-label="Nombre"
                    placeholder="Nombre"
                    onChange={(event) => setName(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-line bg-surface px-3 py-2"
                    value={lastName}
                    aria-label="Apellido"
                    placeholder="Apellido"
                    onChange={(event) => setLastName(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-line bg-surface px-3 py-2"
                    value={email}
                    aria-label="Correo"
                    placeholder="Correo"
                    onChange={(event) => setEmail(event.target.value)}
                  />
                  <input
                    className="rounded-lg border border-line bg-surface px-3 py-2"
                    value={dni}
                    aria-label="DNI"
                    placeholder="DNI"
                    onChange={(event) => setDni(event.target.value)}
                  />
                </div>
                <p className="text-muted">
                  {[ficha.area, ficha.status, ficha.advisor ? `Asesor ${ficha.advisor}` : ''].filter(Boolean).join(' · ')}
                </p>
              </div>
            ) : (
              <>
                <p>
                  {ficha.name}
                  <span className="text-muted"> · solo para comparar</span>
                </p>
                <p className="text-muted">{detail(ficha)}</p>
              </>
            )}
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {kept ? (
          <button
            type="button"
            className="small-btn"
            disabled={busy}
            onClick={() => {
              setBusy(true)
              void apiClient
                .post('/api/admin/conflicts/consolidation/phone/merge', {
                  phone: group.phone,
                  name,
                  last_name: lastName,
                  email,
                  dni,
                })
                .then((result) => {
                  setBusy(false)
                  if (!result.ok) {
                    notify.error(result.error)
                    return
                  }
                  finish('Quedaron unidas')
                })
            }}
          >
            Unir
          </button>
        ) : null}
        <button
          type="button"
          className="small-btn secondary"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void apiClient
              .post('/api/admin/conflicts/consolidation/phone/separate', { phone: group.phone })
              .then((result) => {
                setBusy(false)
                if (!result.ok) {
                  notify.error(result.error)
                  return
                }
                finish('Quedaron separadas')
              })
          }}
        >
          Dejar separadas
        </button>
      </div>
    </article>
  )
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
          Quedan {data.phone_pending}. Ya dejaste {data.phone_done} separadas. Uniste {data.phone_joined}.
          Pasa de página para ver los demás.
        </p>
        <p className="text-sm text-muted">
          Pregunta: ¿estas fichas son la misma persona? Cada tarjeta dice qué dato no coincidió.
          Si lo son, escribe el nombre, el DNI y el correo correctos en la ficha que se queda y pulsa Unir.
          Unir guarda eso, pasa los chats a esa ficha y apaga las otras.
          Si son personas distintas, pulsa Dejar separadas: no se modifica nada.
        </p>
        {data.phones.map((group) => (
          <PhoneConflictCard
            key={group.phone}
            group={group}
            onDone={() => setReload((current) => current + 1)}
          />
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
          Pregunta: ¿lo que llegó es de esta persona? La persona ya existe y no se abre otra.
          Si lo es, corrige teléfono, DNI, correo o WhatsApp y pulsa Guardar en esta persona.
          Si es de otra persona, pulsa Dejar la persona como está: los datos guardados no cambian.
        </p>
        {data.identity.map((row) => (
          <IdentityConflictCard
            key={row.id}
            row={row}
            onDone={() => setReload((current) => current + 1)}
          />
        ))}
        {data.identity.length === 0 ? <p className="text-sm text-muted">No hay datos en conflicto.</p> : null}
      </section>
    </div>
  )
}
