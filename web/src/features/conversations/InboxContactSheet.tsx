import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { ContactForm } from '../contacts/ContactForm'
import { splitPhoneForForm } from '../contacts/phoneUtils'
import { isWhatsAppBsuid } from './whatsappIdentity'
import { segmentOptionsForAssignment, pruneSegmentSlugsToOptions } from '../segments/segmentOptions'
import {
  Sheet,
  SheetBody,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/shared/ui/shadcn/sheet'

type AttributeDefinition = {
  id: number
  segment_slug: string | null
  slug: string
  label: string
  field_type: string
  options?: string[] | null
  sort_order: number
  required: boolean
}

type ContactDetail = {
  id: number
  name: string
  last_name: string
  phone: string | null
  whatsapp_user_id: string | null
  wa_username: string | null
  email: string | null
  dni: string | null
  segment_slugs: string[]
  lead_status_id: number | null
  lead_status: { id: number; slug: string; label: string } | null
  attributes: Record<string, string>
}

type LeadStatusOption = {
  id: number
  slug: string
  label: string
  active: boolean
}

type FilterOptions = {
  segments: Array<{
    id: number
    slug: string
    label: string
    color_key?: string
    category?: string
  }>
  attribute_definitions: AttributeDefinition[]
}

type ApiSegment = {
  id: number
  slug: string
  label: string
  color_key?: string
  active?: boolean
  category?: string
}

export type InboxContactSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'edit' | 'create'
  contactId?: number | null
  conversationId?: number | null
  prefillPhone?: string
  prefillUserId?: string | null
  prefillUsername?: string | null
  prefillName?: string
  category?: string | null
  onSaved: () => void
}

export function InboxContactSheet({
  open,
  onOpenChange,
  mode,
  contactId = null,
  conversationId = null,
  prefillPhone = '',
  prefillUserId = null,
  prefillUsername = null,
  prefillName = '',
  category = null,
  onSaved,
}: InboxContactSheetProps) {
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [segments, setSegments] = useState<FilterOptions['segments']>([])
  const [selectedSegmentSlugs, setSelectedSegmentSlugs] = useState<string[]>([])
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>([])
  const [leadStatuses, setLeadStatuses] = useState<LeadStatusOption[]>([])
  const [leadStatusBusy, setLeadStatusBusy] = useState(false)
  const [attentionBusy, setAttentionBusy] = useState(false)
  const [openLead, setOpenLead] = useState<{
    id: number
    assigned_user_label: string | null
    lead_status: { label: string } | null
    closed_at: string | null
  } | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const phoneParts = useMemo(
    () => splitPhoneForForm(isWhatsAppBsuid(prefillPhone) ? '' : prefillPhone),
    [prefillPhone],
  )
  const contactPhoneParts = useMemo(
    () => (contact ? splitPhoneForForm(contact.phone ?? '') : null),
    [contact],
  )

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoadFailed(false)
    setLoading(true)
    setContact(null)
    setOpenLead(null)
    setSelectedSegmentSlugs([])

    const categoryQs = category ? `category=${encodeURIComponent(category)}` : ''
    async function load() {
      if (mode === 'edit' && contactId) {
        const attentionQs = new URLSearchParams({ contact_id: String(contactId) })
        if (conversationId) attentionQs.set('conversation_id', String(conversationId))
        const [detail, opts, activeSegs, statuses, attention] = await Promise.all([
          apiClient.get<ContactDetail>(
            categoryQs ? `/api/contacts/${contactId}?${categoryQs}` : `/api/contacts/${contactId}`,
          ),
          apiClient.get<FilterOptions>(
            categoryQs ? `/api/contacts/filter-options?${categoryQs}` : '/api/contacts/filter-options',
          ),
          apiClient.get<ApiSegment[]>(
            categoryQs ? `/api/segments/active?${categoryQs}` : '/api/segments/active',
          ),
          apiClient.get<LeadStatusOption[]>('/api/leads/statuses'),
          apiClient.get<{
            id: number
            assigned_user_label: string | null
            lead_status: { label: string } | null
            closed_at: string | null
          } | null>(`/api/leads/attention/current?${attentionQs}`),
        ])
        if (cancelled) return
        if (!detail.ok) {
          notify.error(detail.error)
          setLoadFailed(true)
          setLoading(false)
          return
        }
        setContact(detail.data)
        if (opts.ok) {
          setAttributeDefinitions(opts.data.attribute_definitions)
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
        setOpenLead(attention.ok && attention.data ? attention.data : null)
        setLoading(false)
        return
      }

      const [opts, segs] = await Promise.all([
        apiClient.get<FilterOptions>(
          categoryQs ? `/api/contacts/filter-options?${categoryQs}` : '/api/contacts/filter-options',
        ),
        apiClient.get<ApiSegment[]>(
          categoryQs ? `/api/segments/active?${categoryQs}` : '/api/segments/active',
        ),
      ])
      if (cancelled) return
      if (!opts.ok) {
        notify.error(opts.error)
        setLoadFailed(true)
        setLoading(false)
        return
      }
      setAttributeDefinitions(opts.data.attribute_definitions)
      setSegments(
        segs.ok
          ? segmentOptionsForAssignment(segs.data)
          : opts.data.segments,
      )
      setSelectedSegmentSlugs([])
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, mode, contactId, conversationId, category])

  async function onSubmit(values: {
    name: string
    last_name: string
    phone: string
    phone_prefix: string
    phone_local: string
    whatsapp_user_id?: string | null
    email: string
    dni: string
    segments: string[]
    attributes: Record<string, string>
  }) {
    setSaving(true)
    if (mode === 'create') {
      const result = await apiClient.post<{ id: number }>('/api/contacts', {
        name: values.name,
        last_name: values.last_name,
        phone_prefix: values.phone_prefix,
        phone_local: values.phone_local,
        whatsapp_user_id: values.whatsapp_user_id,
        email: values.email || null,
        dni: values.dni || null,
        segments: values.segments,
        attributes: values.attributes,
        category: category || undefined,
      })
      setSaving(false)
      if (!result.ok) {
        notify.error(result.error)
        return
      }
      notify.success('Contacto guardado.')
      onOpenChange(false)
      onSaved()
      return
    }

    if (!contactId) {
      setSaving(false)
      return
    }
    const result = await apiClient.patch<ContactDetail>(`/api/contacts/${contactId}`, {
      name: values.name,
      last_name: values.last_name,
      phone_prefix: values.phone_prefix,
      phone_local: values.phone_local,
      whatsapp_user_id: values.whatsapp_user_id,
      email: values.email || null,
      dni: values.dni || null,
      segments: values.segments,
      attributes: values.attributes,
      category: category || undefined,
    })
    setSaving(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    notify.success('Contacto actualizado.')
    onOpenChange(false)
    onSaved()
  }

  async function onLeadStatusChange(statusId: number) {
    if (!contactId || !contact) return
    setLeadStatusBusy(true)
    const result = await apiClient.patch<{
      lead_status_id: number | null
      lead_status: ContactDetail['lead_status']
    }>(`/api/leads/contacts/${contactId}/status`, {
      status_id: statusId,
      ...(openLead?.id ? { lead_id: openLead.id } : {}),
      ...(category ? { category } : {}),
    })
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
    const terminal = leadStatuses.find((s) => s.id === statusId)
    if (terminal && !terminal.active) {
      /* keep sheet consistent */
    }
    setOpenLead((prev) =>
      prev
        ? {
            ...prev,
            lead_status: result.data.lead_status
              ? { label: result.data.lead_status.label }
              : prev.lead_status,
          }
        : prev,
    )
    notify.success('Estado actualizado')
    onSaved()
  }

  async function onStartAttention() {
    if (!contactId) return
    setAttentionBusy(true)
    const result = await apiClient.post<{
      id: number
      assigned_user_id: number | null
      lead_status_id: number | null
    }>('/api/leads/attention/start', {
      contact_id: contactId,
      conversation_id: conversationId,
    })
    setAttentionBusy(false)
    if (!result.ok) {
      notify.error(result.error)
      return
    }
    setOpenLead({
      id: result.data.id,
      assigned_user_label: null,
      lead_status: contact?.lead_status
        ? { label: contact.lead_status.label }
        : { label: 'Por contactar' },
      closed_at: null,
    })
    notify.success('Nueva atención iniciada')
    onSaved()
  }

  const formKey =
    mode === 'edit'
      ? `edit-${contact?.id ?? contactId ?? 'pending'}-${selectedSegmentSlugs.join(',')}-${segments.map((s) => s.slug).join(',')}`
      : `create-${prefillPhone}-${prefillUserId ?? ''}-${String(prefillName ?? '').trim()}`

  const ready =
    !loading &&
    !loadFailed &&
    (mode === 'create' || contact != null)

  const statusOptions =
    mode === 'edit' && contact
      ? leadStatuses
          .filter((s) => s.active || s.id === contact.lead_status_id)
          .map((s) => ({ id: s.id, label: s.label }))
      : []

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(100%,32rem)]">
        <SheetHeader>
          <SheetTitle>
            {mode === 'create' ? 'Añadir contacto' : 'Editar contacto'}
          </SheetTitle>
          <SheetDescription>
            {mode === 'create'
              ? 'Guarda este usuario de WhatsApp como contacto sin salir del chat.'
              : 'Actualiza los datos del contacto. El chat permanece abierto.'}
          </SheetDescription>
        </SheetHeader>

        <SheetBody>
          {loadFailed ? (
            <p className="text-sm text-muted">No se pudo cargar</p>
          ) : loading || !ready ? (
            <p className="text-sm text-muted">Cargando formulario…</p>
          ) : (
            <>
              {mode === 'edit' ? (
                <div className="mb-4 space-y-2 rounded-lg border border-line bg-bg p-3">
                  <p className="text-sm font-medium">Atención actual</p>
                  {openLead ? (
                    <p className="muted text-sm">
                      Estado: {openLead.lead_status?.label || '—'}
                      <br />
                      Asesor: {openLead.assigned_user_label || 'Sin asignar'}
                    </p>
                  ) : (
                    <p className="muted text-sm">
                      No hay oportunidad abierta. Puedes chatear y, si corresponde, iniciar una nueva atención.
                    </p>
                  )}
                  {!openLead ? (
                    <button
                      type="button"
                      disabled={attentionBusy}
                      onClick={() => void onStartAttention()}
                      className="rounded-lg border border-line bg-surface-strong px-3 py-1.5 text-sm disabled:opacity-60"
                    >
                      {attentionBusy ? 'Iniciando…' : 'Iniciar atención'}
                    </button>
                  ) : null}
                </div>
              ) : null}
              <p className="mb-2 text-sm font-medium">Perfil del contacto</p>
              <ContactForm
                key={formKey}
                mode={mode}
                segments={segments}
                attributeDefinitions={attributeDefinitions}
                initial={
                  mode === 'edit' && contact && contactPhoneParts
                    ? {
                        name: contact.name,
                        last_name: contact.last_name,
                        phone: contact.phone ?? '',
                        phone_prefix: contactPhoneParts.prefix,
                        phone_local: contactPhoneParts.local,
                        whatsapp_user_id: contact.whatsapp_user_id,
                        wa_username: contact.wa_username,
                        email: contact.email ?? '',
                        dni: contact.dni ?? contact.attributes.dni ?? '',
                        segments: selectedSegmentSlugs,
                        attributes: contact.attributes,
                      }
                    : {
                        name: String(prefillName ?? '').trim(),
                        last_name: '',
                        phone: '',
                        phone_prefix: phoneParts.prefix,
                        phone_local: phoneParts.local,
                        whatsapp_user_id: prefillUserId || (isWhatsAppBsuid(prefillPhone) ? prefillPhone : null),
                        wa_username: prefillUsername,
                        email: '',
                        dni: '',
                        segments: [],
                        attributes: {},
                      }
                }
                saving={saving}
                onSubmit={onSubmit}
                leadStatusOptions={
                  mode === 'edit' && openLead ? statusOptions : undefined
                }
                leadStatusId={contact?.lead_status_id ?? null}
                leadStatusBusy={leadStatusBusy}
                onLeadStatusChange={
                  mode === 'edit' && openLead
                    ? (statusId) => void onLeadStatusChange(statusId)
                    : undefined
                }
              />
              {mode === 'edit' && contactId ? (
                <p className="mt-4 text-sm">
                  <Link
                    to={`/contacts/${contactId}`}
                    className="text-accent hover:underline"
                    onClick={() => onOpenChange(false)}
                  >
                    Abrir perfil completo
                  </Link>
                </p>
              ) : null}
            </>
          )}
        </SheetBody>

        <SheetFooter>
          <SheetClose disabled={saving}>Cerrar</SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
