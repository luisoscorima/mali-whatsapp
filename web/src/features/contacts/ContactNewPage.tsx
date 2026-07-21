import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { ContactForm } from './ContactForm'
import { splitPhoneForForm } from './phoneUtils'

type FilterOptions = {
  segments: Array<{ id: number; slug: string; label: string; color_key?: string }>
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

type ApiSegment = {
  id: number
  slug: string
  label: string
  color_key?: string
}

function safeReturnTo(raw: string | null): string | null {
  if (!raw) return null
  const path = raw.trim()
  if (!path.startsWith('/') || path.startsWith('//')) return null
  if (!path.startsWith('/conversations')) return null
  return path
}

export function ContactNewPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [options, setOptions] = useState<FilterOptions | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  const phoneParts = useMemo(
    () => splitPhoneForForm(searchParams.get('prefill_phone') ?? ''),
    [searchParams],
  )
  const returnTo = useMemo(
    () => safeReturnTo(searchParams.get('return_to')),
    [searchParams],
  )

  useEffect(() => {
    Promise.all([
      apiClient.get<FilterOptions>('/api/contacts/filter-options'),
      apiClient.get<ApiSegment[]>('/api/segments'),
    ]).then(([opts, segs]) => {
      if (!opts.ok) {
        notify.error(opts.error)
        setLoadFailed(true)
        return
      }
      setOptions({
        ...opts.data,
        segments: segs.ok
          ? segs.data.map((s) => ({
              id: s.id,
              slug: s.slug,
              label: s.label,
              color_key: s.color_key,
            }))
          : opts.data.segments,
      })
    })
  }, [])

  async function onSubmit(values: {
    name: string
    last_name: string
    phone_prefix: string
    phone_local: string
    email: string
    dni: string
    segments: string[]
    attributes: Record<string, string>
  }) {
    setSaving(true)
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
    if (returnTo) {
      notify.success('Contacto guardado.')
      navigate(returnTo)
      return
    }
    navigate(`/contacts/${result.data.id}`)
  }

  if (loadFailed) {
    return <p className="text-muted">No se pudo cargar</p>
  }

  if (!options) {
    return <p className="text-muted">Cargando formulario…</p>
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          to={returnTo ?? '/contacts'}
          className="text-sm text-accent hover:underline"
        >
          {returnTo ? '← Volver al chat' : '← Contactos'}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Añadir contacto</h1>
      </div>

      <div className="rounded-xl border border-line bg-surface-strong p-4">
        <ContactForm
          mode="create"
          segments={options.segments}
          attributeDefinitions={options.attribute_definitions}
          initial={{
            name: '',
            last_name: '',
            phone: '',
            phone_prefix: phoneParts.prefix,
            phone_local: phoneParts.local,
            email: '',
            dni: '',
            segments: [],
            attributes: {},
          }}
          saving={saving}
          onSubmit={onSubmit}
        />
      </div>
    </div>
  )
}
