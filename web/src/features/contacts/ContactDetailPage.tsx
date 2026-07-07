import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { ContactForm } from './ContactForm'
import { splitPhoneForForm } from './phoneUtils'

import { formatContactName } from './contactName'

type ContactDetail = {
  id: number
  name: string
  last_name: string
  phone: string
  replaced_by_contact_id: number | null
  replacement_reason: string | null
  segment_slugs: string[]
  attributes: Record<string, string>
  attribute_definitions: Array<{
    id: number
    segment_slug: string | null
    slug: string
    label: string
    field_type: string
    sort_order: number
    required: boolean
  }>
}

type FilterOptions = {
  segments: Array<{ id: number; slug: string; label: string }>
  attribute_definitions: ContactDetail['attribute_definitions']
}

export function ContactDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [segments, setSegments] = useState<FilterOptions['segments']>([])
  const [allAttributeDefs, setAllAttributeDefs] = useState<
    ContactDetail['attribute_definitions']
  >([])
  const [error, setError] = useState('')
  const [saveMsg, setSaveMsg] = useState('')
  const [saving, setSaving] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      apiClient.get<ContactDetail>(`/api/contacts/${id}`),
      apiClient.get<FilterOptions>('/api/contacts/filter-options'),
      apiClient.get<FilterOptions['segments']>('/api/segments'),
    ]).then(([detail, opts, allSegs]) => {
      if (!detail.ok) {
        setError(detail.error)
        return
      }
      setContact(detail.data)
      if (opts.ok) {
        setAllAttributeDefs(opts.data.attribute_definitions)
      }
      if (allSegs.ok) {
        setSegments(
          allSegs.data.map((s) => ({ id: s.id, slug: s.slug, label: s.label })),
        )
      } else if (opts.ok) {
        setSegments(opts.data.segments)
      }
    })
  }, [id])

  const isReplaced = Boolean(
    contact?.replacement_reason || contact?.replaced_by_contact_id,
  )

  async function onSubmit(values: {
    name: string
    last_name: string
    phone: string
    segments: string[]
    attributes: Record<string, string>
  }) {
    if (!id) return
    setSaving(true)
    setSaveMsg('')
    setError('')
    const result = await apiClient.patch<ContactDetail>(`/api/contacts/${id}`, {
      name: values.name,
      last_name: values.last_name,
      phone: values.phone,
      segments: values.segments,
      attributes: values.attributes,
    })
    setSaving(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setSaveMsg('Contacto actualizado.')
    setContact(result.data)
    if (result.data.id !== Number(id)) {
      navigate(`/contacts/${result.data.id}`, { replace: true })
    }
  }

  async function onDelete() {
    if (!id) return
    if (!window.confirm('¿Eliminar este contacto?')) return
    const result = await apiClient.delete(`/api/contacts/${id}`)
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate('/contacts')
  }

  async function onReactivate() {
    if (!id) return
    if (!window.confirm('¿Reactivar este contacto?')) return
    const result = await apiClient.post<ContactDetail>(
      `/api/contacts/${id}/reactivate`,
      {},
    )
    if (!result.ok) {
      setError(result.error)
      return
    }
    setContact(result.data)
    setSaveMsg('Contacto reactivado.')
  }

  async function onOpenChat() {
    if (!id) return
    setChatBusy(true)
    setError('')
    const result = await apiClient.post<{ id: number }>(
      `/api/conversations/from-contact/${id}`,
      {},
    )
    setChatBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    navigate(`/conversations/${result.data.id}`)
  }

  if (error && !contact) {
    return <p className="text-bad">{error}</p>
  }

  if (!contact) {
    return <p className="text-muted">Cargando contacto…</p>
  }

  const phoneParts = splitPhoneForForm(contact.phone)

  return (
    <div className="space-y-4">
      <div>
        <Link to="/contacts" className="text-sm text-accent hover:underline">
          ← Contactos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">
          {formatContactName(contact.name, contact.last_name, contact.phone)}
        </h1>
        <p className="font-mono text-sm text-muted">{contact.phone}</p>
      </div>

      {saveMsg ? <p className="text-sm text-accent">{saveMsg}</p> : null}
      {error ? <p className="text-bad">{error}</p> : null}

      {isReplaced ? (
        <p className="text-sm text-bad">
          Este contacto está reemplazado ({contact.replacement_reason}) y no se
          puede editar.
        </p>
      ) : null}

      <div className="rounded-xl border border-line bg-surface-strong p-4">
        <ContactForm
          mode="edit"
          segments={segments}
          attributeDefinitions={allAttributeDefs}
          isReplaced={isReplaced}
          initial={{
            name: contact.name,
            last_name: contact.last_name,
            phone: contact.phone,
            phone_prefix: phoneParts.prefix,
            phone_local: phoneParts.local,
            segments: contact.segment_slugs,
            attributes: contact.attributes,
          }}
          saving={saving}
          onSubmit={onSubmit}
        />

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            disabled={chatBusy || isReplaced}
            onClick={() => void onOpenChat()}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {chatBusy ? 'Abriendo…' : 'Ir al chat'}
          </button>
          {isReplaced ? (
            <button
              type="button"
              onClick={onReactivate}
              className="rounded-lg border border-line px-4 py-2 text-sm"
            >
              Reactivar contacto
            </button>
          ) : null}
          <button
            type="button"
            onClick={onDelete}
            className="rounded-lg border border-bad px-4 py-2 text-sm text-bad"
          >
            Eliminar contacto
          </button>
        </div>
      </div>
    </div>
  )
}
