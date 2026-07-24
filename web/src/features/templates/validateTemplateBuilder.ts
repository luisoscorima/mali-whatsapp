import type { TemplateBuilderState } from './templateFormUtils'
import { TEMPLATE_NAME_REGEX } from './templateFormUtils'
import {
  buildPreviewWarnings,
  extractPlaceholders,
  labelForPlaceholder,
} from './templatePreviewUtils'

type ValidateOptions = {
  mode: 'create' | 'edit'
  name?: string
}

export function validateTemplateBuilder(
  state: TemplateBuilderState,
  options: ValidateOptions,
): string[] {
  const errors: string[] = []

  if (options.mode === 'create') {
    const name = String(options.name || '').trim()
    if (!TEMPLATE_NAME_REGEX.test(name)) {
      errors.push(
        'El nombre debe ir en snake_case (solo minúsculas, números y guion bajo).',
      )
    }
  }

  if (!String(state.body.text || '').trim()) {
    errors.push('El texto del cuerpo es obligatorio.')
  }

  if (state.header.type === 'text' && !String(state.header.text || '').trim()) {
    errors.push('El texto de cabecera es obligatorio.')
  }

  if (['image', 'video', 'document'].includes(state.header.type)) {
    const hasUrl = Boolean(String(state.header.exampleMediaUrl || '').trim())
    const hasHandle = Boolean(String(state.header.exampleHandle || '').trim())
    if (!hasUrl && !hasHandle) {
      errors.push('La cabecera media requiere una URL pública de ejemplo.')
    }
  }

  if (/\{\{[^{}]+\}\}/.test(state.footer.text || '')) {
    errors.push('El pie no admite variables.')
  }

  const headerPlaceholders = extractPlaceholders(state.header.text)
  headerPlaceholders.forEach((token, idx) => {
    if (!String(state.header.exampleValues[idx] || '').trim()) {
      errors.push(
        `Falta el ejemplo para ${labelForPlaceholder(token, idx)} en cabecera.`,
      )
    }
  })

  const bodyPlaceholders = extractPlaceholders(state.body.text)
  bodyPlaceholders.forEach((token, idx) => {
    if (!String(state.body.exampleValues[idx] || '').trim()) {
      errors.push(
        `Falta el ejemplo para ${labelForPlaceholder(token, idx)} en cuerpo.`,
      )
    }
  })

  state.buttons.forEach((btn, btnIdx) => {
    if (!String(btn.text || '').trim()) {
      errors.push(`Texto del botón ${btnIdx + 1} es obligatorio.`)
    }
    const isQr = String(btn.type || '').toLowerCase() === 'quick_reply'
    if (!isQr) {
      if (!String(btn.url || '').trim()) {
        errors.push(`URL del botón ${btnIdx + 1} es obligatoria.`)
      }
      extractPlaceholders(btn.url).forEach((token, idx) => {
        if (!String(btn.exampleValues[idx] || '').trim()) {
          errors.push(
            `Falta el ejemplo para ${labelForPlaceholder(token, idx)} en botón ${btnIdx + 1}.`,
          )
        }
      })
    }
  })

  if (state.buttons.length > 3) {
    errors.push('Máximo 3 botones por plantilla.')
  }
  const urlButtons = state.buttons.filter(
    (b) => String(b.type || '').toLowerCase() !== 'quick_reply',
  )
  if (urlButtons.length > 2) {
    errors.push('Máximo 2 botones URL por plantilla.')
  }

  errors.push(...buildPreviewWarnings(state))

  return errors
}
