import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'
import { ContactForm } from '../contacts/ContactForm'
import { splitPhoneForForm } from '../contacts/phoneUtils'
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
  phone: string
  email: string | null
  dni: string | null
  replaced_by_contact_id: number | null
  replacement_reason: string | null
  segment_slugs: string[]
  attributes: Record<string, string>
}

type FilterOptions = {
  segments: Array<{ id: number; slug: string; label: string; color_key?: string }>
  attribute_definitions: AttributeDefinition[]
}

type ApiSegment = {
  id: number
  slug: string
  label: string
  color_key?: string
}

function mapSegmentOptions(
  segs: ApiSegment[],
): FilterOptions['segments'] {
  return segs.map((s) => ({
    id: s.id,
    slug: s.slug,
    label: s.label,
    color_key: s.color_key,
  }))
}

export type InboxContactSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'edit' | 'create'
  contactId?: number | null
  prefillPhone?: string
  onSaved: () => void
}

export function InboxContactSheet({
  open,
  onOpenChange,
  mode,
  contactId = null,
  prefillPhone = '',
  onSaved,
}: InboxContactSheetProps) {
  const [contact, setContact] = useState<ContactDetail | null>(null)
  const [segments, setSegments] = useState<FilterOptions['segments']>([])
  const [attributeDefinitions, setAttributeDefinitions] = useState<AttributeDefinition[]>([])
  const [loadFailed, setLoadFailed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  const phoneParts = useMemo(
    () => splitPhoneForForm(prefillPhone),
    [prefillPhone],
  )

  useEffect(() => {
    if (!open) return

    let cancelled = false
    setLoadFailed(false)
    setLoading(true)
    setContact(null)

    async function load() {
      if (mode === 'edit' && contactId) {
        const [detail, opts, allSegs] = await Promise.all([
          apiClient.get<ContactDetail>(`/api/contacts/${contactId}`),
          apiClient.get<FilterOptions>('/api/contacts/filter-options'),
          apiClient.get<ApiSegment[]>('/api/segments'),
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
        if (allSegs.ok) {
          setSegments(mapSegmentOptions(allSegs.data))
        } else if (opts.ok) {
          setSegments(opts.data.segments)
        }
        setLoading(false)
        return
      }

      const [opts, segs] = await Promise.all([
        apiClient.get<FilterOptions>('/api/contacts/filter-options'),
        apiClient.get<ApiSegment[]>('/api/segments'),
      ])
      if (cancelled) return
      if (!opts.ok) {
        notify.error(opts.error)
        setLoadFailed(true)
        setLoading(false)
        return
      }
      setAttributeDefinitions(opts.data.attribute_definitions)
      setSegments(segs.ok ? mapSegmentOptions(segs.data) : opts.data.segments)
      setLoading(false)
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open, mode, contactId])

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
    setSaving(true)
    if (mode === 'create') {
      const result = await apiClient.post<{ id: number }>('/api/contacts', {
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
      phone: values.phone,
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
    onOpenChange(false)
    onSaved()
  }

  const formKey =
    mode === 'edit'
      ? `edit-${contact?.id ?? contactId ?? 'pending'}`
      : `create-${prefillPhone}`

  const ready =
    !loading &&
    !loadFailed &&
    (mode === 'create' || contact != null)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[min(100%,32rem)]">
        <SheetHeader>
          <SheetTitle>
            {mode === 'create' ? 'Añadir contacto' : 'Editar contacto'}
          </SheetTitle>
          <SheetDescription>
            {mode === 'create'
              ? 'Guarda este número como contacto sin salir del chat.'
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
              {isReplaced ? (
                <p className="mb-4 text-sm text-bad">
                  Este contacto está reemplazado
                  {contact?.replacement_reason
                    ? ` (${contact.replacement_reason})`
                    : ''}{' '}
                  y no se puede editar.
                </p>
              ) : null}
              <ContactForm
                key={formKey}
                mode={mode}
                segments={segments}
                attributeDefinitions={attributeDefinitions}
                isReplaced={isReplaced}
                initial={
                  mode === 'edit' && contact
                    ? {
                        name: contact.name,
                        last_name: contact.last_name,
                        phone: contact.phone,
                        phone_prefix: splitPhoneForForm(contact.phone).prefix,
                        phone_local: splitPhoneForForm(contact.phone).local,
                        email: contact.email ?? '',
                        dni: contact.dni ?? contact.attributes.dni ?? '',
                        segments: contact.segment_slugs,
                        attributes: contact.attributes,
                      }
                    : {
                        name: '',
                        last_name: '',
                        phone: '',
                        phone_prefix: phoneParts.prefix,
                        phone_local: phoneParts.local,
                        email: '',
                        dni: '',
                        segments: [],
                        attributes: {},
                      }
                }
                saving={saving}
                onSubmit={onSubmit}
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
