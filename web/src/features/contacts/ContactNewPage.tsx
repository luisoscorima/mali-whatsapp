import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiClient } from '../../shared/api'
import { ContactForm } from './ContactForm'
import { WaSpanMainPage } from '@/shared/ui/shell/WaSpanMainPage'

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
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiClient.get<FilterOptions>('/api/contacts/filter-options').then((res) => {
      if (res.ok) setOptions(res.data)
      else setError(res.error)
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
    setError('')
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
      setError(result.error)
      return
    }
    navigate(`/contacts/${result.data.id}`)
  }

  if (error && !options) {
    return (
      <WaSpanMainPage title="Añadir contacto">
        <p className="text-bad">{error}</p>
      </WaSpanMainPage>
    )
  }

  if (!options) {
    return (
      <WaSpanMainPage title="Añadir contacto">
        <p className="text-muted">Cargando formulario…</p>
      </WaSpanMainPage>
    )
  }

  return (
    <WaSpanMainPage>
    <div className="space-y-4">
      <div>
        <Link to="/contacts" className="text-sm text-accent hover:underline">
          ← Contactos
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">Añadir contacto</h1>
      </div>

      {error ? <p className="text-bad">{error}</p> : null}

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
    </WaSpanMainPage>
  )
}
