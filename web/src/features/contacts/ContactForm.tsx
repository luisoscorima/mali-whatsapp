import { type FormEvent, type ReactNode, useMemo, useState } from 'react'
import { SegmentFilterSelect } from '../segments/SegmentFilterSelect'
import {
  getApplicableAttributeDefinitions,
  inputTypeForField,
  type AttributeFieldDefinition,
} from './contactFormUtils'

type SegmentOption = {
  id: number
  slug: string
  label: string
  color_key?: string
}

type ContactFormValues = {
  name: string
  last_name: string
  phone: string
  phone_prefix: string
  phone_local: string
  email: string
  dni: string
  segments: string[]
  attributes: Record<string, string>
}

type ContactFormProps = {
  mode: 'create' | 'edit'
  segments: SegmentOption[]
  attributeDefinitions: AttributeFieldDefinition[]
  initial: ContactFormValues
  isReplaced?: boolean
  saving?: boolean
  actions?: ReactNode
  onSubmit: (values: ContactFormValues) => void
}

const NATIVE_ATTR_SLUGS = new Set(['dni', 'email', 'correo'])

export function ContactForm({
  mode,
  segments,
  attributeDefinitions,
  initial,
  isReplaced = false,
  saving = false,
  actions,
  onSubmit,
}: ContactFormProps) {
  const [name, setName] = useState(initial.name)
  const [lastName, setLastName] = useState(initial.last_name)
  const [phonePrefix, setPhonePrefix] = useState(initial.phone_prefix)
  const [phoneLocal, setPhoneLocal] = useState(initial.phone_local)
  const [email, setEmail] = useState(initial.email)
  const [dni, setDni] = useState(initial.dni)
  const [selectedSegments, setSelectedSegments] = useState<string[]>(
    initial.segments,
  )
  const [attributes, setAttributes] = useState<Record<string, string>>(
    initial.attributes,
  )
  const [segmentsError, setSegmentsError] = useState('')

  const applicableDefs = useMemo(
    () =>
      getApplicableAttributeDefinitions(
        attributeDefinitions,
        selectedSegments,
      ).filter((d) => !NATIVE_ATTR_SLUGS.has(d.slug)),
    [attributeDefinitions, selectedSegments],
  )

  const filterSegments = useMemo(
    () =>
      segments.map((seg) => ({
        slug: seg.slug,
        label: seg.label,
        color_key: seg.color_key ?? 'slate',
      })),
    [segments],
  )

  const disabled = isReplaced || segments.length === 0

  function toggleSegment(slug: string) {
    setSelectedSegments((prev) => {
      const next = prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug]
      if (next.length > 0) setSegmentsError('')
      return next
    })
  }

  function setAttribute(slug: string, value: string) {
    setAttributes((prev) => ({ ...prev, [slug]: value }))
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (selectedSegments.length < 1) {
      setSegmentsError('Indica al menos un segmento')
      return
    }
    setSegmentsError('')
    const prefixDigits = phonePrefix.replace(/\D/g, '')
    const localDigits = phoneLocal.replace(/\D/g, '')
    onSubmit({
      name,
      last_name: lastName,
      phone: `${prefixDigits}${localDigits}`,
      phone_prefix: phonePrefix,
      phone_local: phoneLocal,
      email,
      dni,
      segments: selectedSegments,
      attributes,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-lg space-y-4">
      <label className="block text-sm">
        <span className="text-muted">Nombre</span>
        <input
          type="text"
          required
          maxLength={120}
          value={name}
          disabled={disabled}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
        />
      </label>

      <label className="block text-sm">
        <span className="text-muted">Apellido (opcional)</span>
        <input
          type="text"
          maxLength={120}
          value={lastName}
          disabled={disabled}
          onChange={(e) => setLastName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm sm:col-span-1">
          <span className="text-muted">Prefijo país</span>
          <input
            type="text"
            maxLength={4}
            inputMode="numeric"
            value={phonePrefix}
            disabled={disabled}
            onChange={(e) => setPhonePrefix(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
          />
        </label>
        <label className="block text-sm sm:col-span-2">
          <span className="text-muted">Número (sin +51)</span>
          <input
            type="text"
            required
            inputMode="numeric"
            placeholder="982160981"
            value={phoneLocal}
            disabled={disabled}
            onChange={(e) => setPhoneLocal(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
          />
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-muted">Email (opcional)</span>
        <input
          type="email"
          maxLength={255}
          value={email}
          disabled={disabled}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
        />
      </label>

      <label className="block text-sm">
        <span className="text-muted">DNI (opcional)</span>
        <input
          type="text"
          maxLength={32}
          value={dni}
          disabled={disabled}
          onChange={(e) => setDni(e.target.value)}
          className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2 font-mono"
        />
      </label>

      <fieldset className="space-y-2 text-sm" disabled={disabled}>
        <legend className="font-medium">Segmentos</legend>
        {segments.length === 0 ? (
          <p className="text-muted">Define segmentos en Segmentos.</p>
        ) : (
          <SegmentFilterSelect
            variant="form"
            segments={filterSegments}
            selectedSlugs={selectedSegments}
            onToggle={toggleSegment}
            onClearAll={() => {
              setSelectedSegments([])
            }}
            disabled={disabled}
          />
        )}
        <p className="text-xs text-muted">Obligatorio: elige uno o varios.</p>
        {segmentsError ? (
          <p className="text-xs text-bad">{segmentsError}</p>
        ) : null}
      </fieldset>

      <div className="space-y-3">
        <p className="text-sm font-medium">
          Atributos{' '}
          <span className="font-normal text-muted">(opcional)</span>
        </p>
        {applicableDefs.length === 0 ? (
          <p className="text-sm text-muted">
            {selectedSegments.length === 0 && mode === 'create'
              ? 'Selecciona segmentos para ver atributos específicos.'
              : 'No hay campos definidos.'}
          </p>
        ) : (
          applicableDefs.map((def) => (
            <label key={`${def.slug}:${def.segment_slug ?? ''}`} className="block text-sm">
              <span className="text-muted">
                {def.label}
                {def.segment_slug ? ` · ${def.segment_slug}` : ''}
                {def.required ? ' *' : ''}
              </span>
              {def.field_type === 'select' ? (
                <select
                  required={def.required && !disabled}
                  disabled={disabled}
                  value={attributes[def.slug] ?? ''}
                  onChange={(e) => setAttribute(def.slug, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
                >
                  <option value="">{def.required ? '—' : ''}</option>
                  {(def.options ?? []).map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                  {attributes[def.slug] &&
                  !(def.options ?? []).includes(attributes[def.slug]) ? (
                    <option value={attributes[def.slug]}>
                      {attributes[def.slug]}
                    </option>
                  ) : null}
                </select>
              ) : (
                <input
                  type={inputTypeForField(def.field_type)}
                  maxLength={500}
                  required={def.required && !disabled}
                  disabled={disabled}
                  value={attributes[def.slug] ?? ''}
                  onChange={(e) => setAttribute(def.slug, e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line bg-bg px-3 py-2"
                />
              )}
            </label>
          ))
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={disabled || saving}
          className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
        >
          {saving ? 'Guardando…' : mode === 'create' ? 'Guardar' : 'Guardar cambios'}
        </button>
        {actions}
      </div>
    </form>
  )
}
