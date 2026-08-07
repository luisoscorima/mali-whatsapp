import { useEffect, useState } from 'react'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'

export type TemplateParamDef = {
  index: number
  label: string
}

export type WizardTemplateDefinition = {
  needsHeaderMedia: boolean
  headerMedia: string | null
  headerTextSlotCount: number
  headerParamDefs: TemplateParamDef[]
  bodySlotCount: number
  bodyParamDefs: TemplateParamDef[]
  totalButtonParams: number
  buttonParamDefs: TemplateParamDef[]
}

export type AttributeOption = {
  slug: string
  label: string
}

export type CampaignTemplateFormState = {
  headerMediaUrl: string
  headerParams: string[]
  bodyParams: string[]
  buttonParams: string[]
  headerParamSources: string[]
  bodyParamSources: string[]
  buttonParamSources: string[]
}

export const emptyTemplateFormState = (): CampaignTemplateFormState => ({
  headerMediaUrl: '',
  headerParams: [],
  bodyParams: [],
  buttonParams: [],
  headerParamSources: [],
  bodyParamSources: [],
  buttonParamSources: [],
})

function buildEmptyForm(def: WizardTemplateDefinition): CampaignTemplateFormState {
  return {
    headerMediaUrl: '',
    headerParams: Array(def.headerTextSlotCount).fill(''),
    bodyParams: Array(def.bodySlotCount).fill(''),
    buttonParams: Array(def.totalButtonParams).fill(''),
    headerParamSources: Array(def.headerTextSlotCount).fill('static'),
    bodyParamSources: Array(def.bodySlotCount).fill('static'),
    buttonParamSources: Array(def.totalButtonParams).fill('static'),
  }
}

type ParamRowProps = {
  label: string
  value: string
  source: string
  attrs: AttributeOption[]
  onValueChange: (value: string) => void
  onSourceChange: (source: string) => void
}

function ParamRow({
  label,
  value,
  source,
  attrs,
  onValueChange,
  onSourceChange,
}: ParamRowProps) {
  const isStatic = source === 'static'
  const sourceLabel =
    source === 'static'
      ? 'valor fijo'
      : source === 'contact.name'
        ? 'nombre del contacto'
        : source === 'contact.phone'
          ? 'teléfono del contacto'
          : source === 'contact.email'
            ? 'email del contacto'
            : source === 'contact.dni'
              ? 'DNI del contacto'
              : attrs.find((a) => `attr.${a.slug}` === source)?.label?.toLowerCase() ||
                'valor por contacto'

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-3">
      <label className="block text-sm">
        <span className="text-muted">{label}</span>
        <input
          type="text"
          className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm disabled:opacity-60"
          value={isStatic ? value : ''}
          disabled={!isStatic}
          required={isStatic}
          maxLength={1024}
          placeholder={
            isStatic
              ? 'Dato fijo para todos los destinatarios'
              : `Se completará con ${sourceLabel}`
          }
          onChange={(e) => onValueChange(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        <span className="text-muted">Origen del valor</span>
        <select
          className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2 text-sm"
          value={source}
          onChange={(e) => onSourceChange(e.target.value)}
        >
          <option value="static">Valor fijo (igual para todos)</option>
          <option value="contact.name">Nombre del contacto</option>
          <option value="contact.phone">Teléfono del contacto</option>
          <option value="contact.email">Email del contacto</option>
          <option value="contact.dni">DNI del contacto</option>
          {attrs.map((a) => (
            <option key={a.slug} value={`attr.${a.slug}`}>
              Atributo: {a.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted">
        {isStatic
          ? 'Escribe el dato fijo que se enviará igual para todos los destinatarios.'
          : `Se completará automáticamente con ${sourceLabel}.`}
      </p>
    </div>
  )
}

type Props = {
  templateId: string
  attrDefs: AttributeOption[]
  form: CampaignTemplateFormState
  onFormChange: (next: CampaignTemplateFormState) => void
  onReadyChange: (ready: boolean) => void
}

export function CampaignTemplateFields({
  templateId,
  attrDefs,
  form,
  onFormChange,
  onReadyChange,
}: Props) {
  const [def, setDef] = useState<WizardTemplateDefinition | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!templateId) {
      setDef(null)
      setLoadError('')
      onReadyChange(false)
      return
    }

    let cancelled = false
    setLoading(true)
    setLoadError('')
    onReadyChange(false)

    apiClient
      .get<WizardTemplateDefinition>(`/api/templates/${templateId}/definition`)
      .then((result) => {
        if (cancelled) return
        setLoading(false)
        if (!result.ok) {
          notify.error(result.error)
          setLoadError(result.error)
          setDef(null)
          onReadyChange(false)
          return
        }
        setDef(result.data)
        onFormChange(buildEmptyForm(result.data))
        onReadyChange(true)
      })

    return () => {
      cancelled = true
    }
  }, [templateId])

  if (!templateId) {
    return null
  }

  if (loading) {
    return <p className="text-sm text-muted">Cargando parámetros de plantilla…</p>
  }

  if (loadError) {
    return <p className="text-sm text-muted">No se pudo cargar</p>
  }

  if (!def) {
    return null
  }

  const hasParams =
    def.needsHeaderMedia ||
    def.headerTextSlotCount > 0 ||
    def.bodySlotCount > 0 ||
    def.totalButtonParams > 0

  function updateForm(patch: Partial<CampaignTemplateFormState>) {
    onFormChange({ ...form, ...patch })
  }

  function updateList(
    key: 'headerParams' | 'bodyParams' | 'buttonParams',
    sourceKey: 'headerParamSources' | 'bodyParamSources' | 'buttonParamSources',
    index: number,
    value: string,
    isSource: boolean,
  ) {
    const list = [...form[key]]
    const sources = [...form[sourceKey]]
    if (isSource) {
      sources[index] = value
    } else {
      list[index] = value
    }
    updateForm({ [key]: list, [sourceKey]: sources })
  }

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <p className="text-sm font-medium">Contenido de la plantilla</p>
      {!hasParams ? (
        <p className="text-sm text-muted">
          Esta plantilla no requiere parámetros variables.
        </p>
      ) : null}

      {def.needsHeaderMedia ? (
        <label className="block text-sm">
          <span className="text-muted">
            {def.headerMedia === 'IMAGE'
              ? 'URL imagen (cabecera)'
              : def.headerMedia === 'VIDEO'
                ? 'URL video (cabecera)'
                : 'URL documento (cabecera)'}
          </span>
          <input
            type="url"
            required
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            placeholder="https://…"
            value={form.headerMediaUrl}
            onChange={(e) => updateForm({ headerMediaUrl: e.target.value })}
          />
        </label>
      ) : null}

      {Array.from({ length: def.headerTextSlotCount }).map((_, i) => (
        <ParamRow
          key={`h-${i}`}
          label={def.headerParamDefs[i]?.label || `Texto cabecera (${i + 1})`}
          value={form.headerParams[i] || ''}
          source={form.headerParamSources[i] || 'static'}
          attrs={attrDefs}
          onValueChange={(v) =>
            updateList('headerParams', 'headerParamSources', i, v, false)
          }
          onSourceChange={(s) =>
            updateList('headerParams', 'headerParamSources', i, s, true)
          }
        />
      ))}

      {Array.from({ length: def.bodySlotCount }).map((_, i) => (
        <ParamRow
          key={`b-${i}`}
          label={def.bodyParamDefs[i]?.label || `Texto cuerpo (${i + 1})`}
          value={form.bodyParams[i] || ''}
          source={form.bodyParamSources[i] || 'static'}
          attrs={attrDefs}
          onValueChange={(v) =>
            updateList('bodyParams', 'bodyParamSources', i, v, false)
          }
          onSourceChange={(s) =>
            updateList('bodyParams', 'bodyParamSources', i, s, true)
          }
        />
      ))}

      {Array.from({ length: def.totalButtonParams }).map((_, i) => (
        <ParamRow
          key={`btn-${i}`}
          label={def.buttonParamDefs[i]?.label || `Botón URL (${i + 1})`}
          value={form.buttonParams[i] || ''}
          source={form.buttonParamSources[i] || 'static'}
          attrs={attrDefs}
          onValueChange={(v) =>
            updateList('buttonParams', 'buttonParamSources', i, v, false)
          }
          onSourceChange={(s) =>
            updateList('buttonParams', 'buttonParamSources', i, s, true)
          }
        />
      ))}
    </div>
  )
}
