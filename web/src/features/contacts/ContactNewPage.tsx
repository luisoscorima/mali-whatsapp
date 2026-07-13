import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { ContactForm } from './ContactForm'

type FilterOptions = {
  segments: Array<{ id: number; slug: string; label: string }>
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

export function ContactNewPage() {
  const navigate = useNavigate()
  const [options, setOptions] = useState<FilterOptions | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      apiClient.get<FilterOptions>('/api/contacts/filter-options'),
      apiClient.get<FilterOptions['segments']>('/api/segments'),
    ]).then(([opts, segs]) => {
      if (!opts.ok) {
        notify.error(opts.error)
        setLoadFailed(true)
        return
      }
      setOptions({
        ...opts.data,
        segments: segs.ok ? segs.data.map((s) => ({ id: s.id, slug: s.slug, label: s.label })) : opts.data.segments,
      })
    })
  }, [])

  async function onSubmit(values: {
    name: string
    last_name: string
    phone_prefix: string
    phone_local: string
    segments: string[]
    attributes: Record<string, string>
  }) {
    setSaving(true)
    const result = await apiClient.post<{ id: number }>('/api/contacts', {
      name: values.name,
      last_name: values.last_name,
      phone_prefix: values.phone_prefix,
      phone_local: values.phone_local,
      segments: values.segments,
      attributes: values.attributes,
    })
    setSaving(false)
    if (!result.ok) {
      notify.error(result.error)
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
        <Link to="/contacts" className="text-sm text-accent hover:underline">
          ← Contactos
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
            phone_prefix: '51',
            phone_local: '',
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
