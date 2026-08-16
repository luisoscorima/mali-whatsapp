import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { ContactForm } from './ContactForm'
import { splitPhoneForForm } from './phoneUtils'
import { segmentOptionsForAssignment, pruneSegmentSlugsToOptions } from '../segments/segmentOptions'

import { formatContactName } from './contactName'
import { useConfirmDialog } from '@/shared/ui/ConfirmDialog'

type ContactDetail = {
  id: number
  name: string
  last_name: string
  phone: string
  email: string | null
  dni: string | null
  replaced_by_contact_id: number | null
  replacement_reason: string | null
  segment_slugs: string[]
  lead_status_id: number | null
  lead_status: { id: number; slug: string; label: string } | null
  attributes: Record<string, string>
  attribute_definitions: Array<{
    id: number
    segment_slug: string | null
    slug: string
    label: string
    field_type: string
    options?: string[] | null
    sort_order: number
    required: boolean
  }>
}

type LeadStatusOption = {
  id: number
  slug: string
  label: string
  active: boolean
}

type FilterOptions = {
  segments: Array<{ id: number; slug: string; label: string; color_key?: string }>
  attribute_definitions: ContactDetail['attribute_definitions']
}

type ApiSegment = {
  id: number
  slug: string
  label: string
  color_key?: string
  active: boolean
}

export function ContactDetailPage() {
  const { id } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { confirm, confirmDialog } = useConfirmDialog()
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [segments, setSegments] = useState<FilterOptions['segments']>([])
  const [selectedSegmentSlugs, setSelectedSegmentSlugs] = useState<string[]>([])
  const [allAttributeDefs, setAllAttributeDefs] = useState<
    ContactDetail['attribute_definitions']
  >([])
  const [leadStatuses, setLeadStatuses] = useState<LeadStatusOption[]>([])
  const [leadStatusBusy, setLeadStatusBusy] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [chatBusy, setChatBusy] = useState(false)

  useEffect(() => {
    if (!id) return
    Promise.all([
      apiClient.get<ContactDetail>(`/api/contacts/${id}`),
      apiClient.get<FilterOptions>('/api/contacts/filter-options'),
      apiClient.get<ApiSegment[]>('/api/segments/active'),
      apiClient.get<LeadStatusOption[]>('/api/leads/statuses'),
    ]).then(([detail, opts, activeSegs, statuses]) => {
      if (!detail.ok) {
        notify.error(detail.error)
        setLoadFailed(true)
        return
      }
      setContact(detail.data)
      if (opts.ok) {
        setAllAttributeDefs(opts.data.attribute_definitions)
      }
      const options = activeSegs.ok
        ? segmentOptionsForAssignment(activeSegs.data)
        : opts.ok
          ? opts.data.segments
          : []
      setSegments(options)
      setSelectedSegmentSlugs(
        pruneSegmentSlugsToOptions(detail.data.segment_slugs, options),
      )
      if (statuses.ok) setLeadStatuses(statuses.data)
    })
  }, [id])

  const isReplaced = Boolean(
    contact?.replacement_reason || contact?.replaced_by_contact_id,
  )

  async function onSubmit(values: {
    name: string
    last_name: string
    phone: string
    phone_prefix: string
    phone_local: string
    email: string
    dni: string
    segments: string[]
    attributes: Record<string, string>
  }) {
    if (!id) return
    setSaving(true)
    const result = await apiClient.patch<ContactDetail>(`/api/contacts/${id}`, {
      name: values.name,
      last_name: values.last_name,
      phone_prefix: values.phone_prefix,
      phone_local: values.phone_local,
      email: values.email || null,
      dni: values.dni || null,
      segments: values.segments,
      attributes: values.attributes,
    })
    setSaving(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success('Contacto actualizado.')
    setContact(result.data)
    if (result.data.id !== Number(id)) {
      navigate(`/contacts/${result.data.id}${location.search}`, { replace: true })
    }
  }

  async function onDelete() {
    if (!id) return
    if (
      !(await confirm({
        title: 'Eliminar contacto',
        description: '¿Eliminar este contacto?',
        confirmLabel: 'Eliminar',
        tone: 'danger',
      }))
    ) {
      return
    }
    const result = await apiClient.delete(`/api/contacts/${id}`)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    navigate(`/contacts${location.search}`)
  }

  async function onReactivate() {
    if (!id) return
    if (
      !(await confirm({
        title: 'Reactivar contacto',
        description: '¿Reactivar este contacto?',
        confirmLabel: 'Reactivar',
      }))
    ) {
      return
    }
    const result = await apiClient.post<ContactDetail>(
      `/api/contacts/${id}/reactivate`,
      {},
    )
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setContact(result.data)
    notify.success('Contacto reactivado.')
  }

  async function onOpenChat() {
    if (!id) return
    setChatBusy(true)
    const result = await apiClient.post<{ id: number }>(
      `/api/conversations/from-contact/${id}`,
      {},
    )
    setChatBusy(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    navigate(`/conversations/${result.data.id}`)
  }

  async function onLeadStatusChange(statusId: number) {
    if (!id || !contact) return
    setLeadStatusBusy(true)
    const result = await apiClient.patch<{
      lead_status_id: number | null
      lead_status: ContactDetail['lead_status']
    }>(`/api/leads/contacts/${id}/status`, { status_id: statusId })
    setLeadStatusBusy(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setContact((prev) =>
      prev
        ? {
            ...prev,
            lead_status_id: result.data.lead_status_id,
            lead_status: result.data.lead_status,
          }
        : prev,
    )
    notify.success('Estado actualizado')
  }

  if (loadFailed) {
    return <p className="text-muted">No se pudo cargar</p>
  }

  if (!contact) {
    return <p className="text-muted">Cargando contacto…</p>
  }

  const phoneParts = splitPhoneForForm(contact.phone)
  const listHref = `/contacts${location.search}`
  const statusOptions = leadStatuses
    .filter((s) => s.active || s.id === contact.lead_status_id)
    .map((s) => ({ id: s.id, label: s.label }))

  return (
    <div className="space-y-4">
      {confirmDialog}
      <div className="contact-detail-heading">
        <Link to={listHref} className="contact-detail-back" aria-label="Volver a contactos">
          ‹
        </Link>
        <div className="min-w-0">
          <h1 className="contact-detail-title">
            {formatContactName(contact.name, contact.last_name, contact.phone)}
          </h1>
          <p className="contact-detail-phone">{contact.phone}</p>
        </div>
      </div>

      {isReplaced ? (
        <p className="text-sm text-bad">
          Este contacto está reemplazado ({contact.replacement_reason}) y no se
          puede editar.
        </p>
      ) : null}

      <div className="rounded-xl border border-line bg-surface-strong p-4">
        <ContactForm
          key={contact.id}
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
            email: contact.email ?? '',
            dni: contact.dni ?? contact.attributes.dni ?? '',
            segments: selectedSegmentSlugs,
            attributes: contact.attributes,
          }}
          saving={saving}
          onSubmit={onSubmit}
          leadStatusOptions={statusOptions}
          leadStatusId={contact.lead_status_id}
          leadStatusBusy={leadStatusBusy}
          onLeadStatusChange={(statusId) => void onLeadStatusChange(statusId)}
          actions={
            <>
              <button
                type="button"
                disabled={chatBusy || isReplaced}
                onClick={() => void onOpenChat()}
                className="rounded-lg border border-line bg-bg px-4 py-2 text-sm disabled:opacity-60"
              >
                {chatBusy ? 'Abriendo…' : 'Ir al chat'}
              </button>
              {isReplaced ? (
                <button
                  type="button"
                  onClick={() => void onReactivate()}
                  className="rounded-lg border border-line bg-bg px-4 py-2 text-sm"
                >
                  Reactivar contacto
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void onDelete()}
                className="rounded-lg border border-bad px-4 py-2 text-sm text-bad"
              >
                Eliminar contacto
              </button>
            </>
          }
        />
      </div>
    </div>
  )
}
