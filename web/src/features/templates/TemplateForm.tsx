import { useState } from 'react'
import type { FormEvent } from 'react'
import { apiClient } from '../../shared/api'
import { notify } from '@/shared/notify'
import { TemplateBuilderFields } from './TemplateBuilderFields'
import { TemplateLivePreview } from './TemplateLivePreview'
import {
  ensureExampleValues,
  normalizeTemplateNameInput,
  type TemplateBuilderState,
} from './templateFormUtils'
import { extractPlaceholders } from './templatePreviewUtils'
import { validateTemplateBuilder } from './validateTemplateBuilder'

type TemplateFormProps = {
  mode: 'create' | 'edit'
  initialName?: string
  initialLanguage?: string
  initialCategory?: string
  initialBuilder: TemplateBuilderState
  sourceTemplateId?: number
  submitLabel: string
  onSubmit: (payload: {
    name?: string
    language?: string
    category: string
    builder: TemplateBuilderState
    source_template_id?: number
  }) => Promise<void>
}

function finalizeBuilder(state: TemplateBuilderState): TemplateBuilderState {
  return {
    ...state,
    header: {
      ...state.header,
      exampleValues: ensureExampleValues(
        state.header.exampleValues,
        extractPlaceholders(state.header.text).length,
      ),
    },
    body: {
      ...state.body,
      exampleValues: ensureExampleValues(
        state.body.exampleValues,
        extractPlaceholders(state.body.text).length,
      ),
    },
    buttons: state.buttons.map((btn) => ({
      ...btn,
      exampleValues: ensureExampleValues(
        btn.exampleValues,
        extractPlaceholders(btn.url).length,
      ),
    })),
  }
}

const META_CONFIRM_MESSAGE =
  'Meta revisará la plantilla antes de aprobarla. Solo las aprobadas se pueden usar en campañas. ¿Enviar ahora?'

export function TemplateForm({
  mode,
  initialName = '',
  initialLanguage = 'es',
  initialCategory = 'MARKETING',
  initialBuilder,
  sourceTemplateId,
  submitLabel,
  onSubmit,
}: TemplateFormProps) {
  const [name, setName] = useState(initialName)
  const [language, setLanguage] = useState(initialLanguage)
  const [category, setCategory] = useState(initialCategory)
  const [builder, setBuilder] = useState<TemplateBuilderState>(initialBuilder)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()

    const payloadBuilder = finalizeBuilder(builder)
    const normalizedName =
      mode === 'create' ? normalizeTemplateNameInput(name) : undefined
    const validationErrors = validateTemplateBuilder(payloadBuilder, {
      mode,
      name: normalizedName,
    })
    if (validationErrors.length > 0) {
      notify.error(validationErrors.join(' '))
      return
    }

    if (!window.confirm(META_CONFIRM_MESSAGE)) {
      return
    }

    setSaving(true)
    try {
      const validateResult = await apiClient.post<{ valid: true }>(
        '/api/templates/validate',
        { builder: payloadBuilder },
      )
      if (!validateResult.ok) {
        notify.error(validateResult.error)
        return
      }

      await onSubmit({
        name: normalizedName,
        language: mode === 'create' ? language.trim() : undefined,
        category,
        builder: payloadBuilder,
        source_template_id: sourceTemplateId,
      })
    } catch (submitError) {
      notify.error(
        submitError instanceof Error
          ? submitError.message
          : 'No se pudo guardar la plantilla',
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <p className="text-sm text-muted">
        Se envía a revisión en Meta. Puedes usar variables como{' '}
        <code className="font-mono text-xs">{'{{fecha}}'}</code> o{' '}
        <code className="font-mono text-xs">{'{{mes}}'}</code>; el sistema las
        normaliza a placeholders numéricos.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'create' ? (
          <>
            <label className="block text-sm">
              <span className="text-muted">Nombre (snake_case)</span>
              <input
                className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                pattern="[a-z0-9_]+"
                placeholder="recordatorio_pago_mayo"
              />
            </label>
            <label className="block text-sm">
              <span className="text-muted">Idioma</span>
              <input
                className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                required
              />
            </label>
          </>
        ) : (
          <>
            <div className="text-sm">
              <p className="text-muted">Nombre</p>
              <p className="mt-1 font-mono">{initialName}</p>
            </div>
            <div className="text-sm">
              <p className="text-muted">Idioma</p>
              <p className="mt-1">{initialLanguage}</p>
            </div>
          </>
        )}
        <label
          className={`block text-sm ${mode === 'edit' ? 'sm:col-span-2' : ''}`}
        >
          <span className="text-muted">Categoría</span>
          <select
            className="mt-1 w-full rounded-lg border border-line bg-surface-strong px-3 py-2"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="MARKETING">MARKETING</option>
            <option value="UTILITY">UTILITY</option>
            <option value="AUTHENTICATION">AUTHENTICATION</option>
          </select>
        </label>
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <div className="space-y-4">
          <TemplateBuilderFields builder={builder} onChange={setBuilder} />
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-accent px-4 py-2 text-sm text-white disabled:opacity-60"
          >
            {saving ? 'Enviando…' : submitLabel}
          </button>
        </div>
        <aside className="xl:sticky xl:top-4">
          <TemplateLivePreview state={builder} />
        </aside>
      </div>
    </form>
  )
}
