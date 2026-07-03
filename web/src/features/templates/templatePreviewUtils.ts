import type { TemplateBuilderState } from './templateFormUtils'

const PLACEHOLDER_RE = /\{\{([^{}]+)\}\}/g

export type PreviewMode = 'aliases' | 'examples'

export type MappingItem = {
  scope: string
  token: string
  position: number
  example: string
}

export function extractPlaceholders(text: string): string[] {
  const matches: string[] = []
  const seen = new Set<string>()
  const re = new RegExp(PLACEHOLDER_RE.source, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(String(text || ''))) !== null) {
    const token = String(match[1] || '').trim()
    if (!token || seen.has(token)) continue
    seen.add(token)
    matches.push(token)
  }
  return matches
}

export function sanitizeAlias(raw: string | null): string {
  let value = String(raw || '')
    .trim()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+/, '')
    .replace(/_+/g, '_')
  if (/^\d/.test(value)) value = `var_${value}`
  return value
}

export function labelForPlaceholder(token: string, idx: number): string {
  if (/^\d+$/.test(token)) return `{{${token}}}`
  return `${token} ({{${idx + 1}}})`
}

export function alignExampleValues(values: string[], count: number): string[] {
  const out = values.slice(0, count)
  while (out.length < count) out.push('')
  return out
}

export function applyPreviewMode(
  text: string,
  exampleValues: string[],
  mode: PreviewMode,
): string {
  const placeholders = extractPlaceholders(text)
  if (!placeholders.length) return String(text || '')
  const examples = alignExampleValues(exampleValues, placeholders.length)
  if (mode !== 'examples') return String(text || '')
  return String(text || '').replace(
    /\{\{([^{}]+)\}\}/g,
    (_, token: string) => {
      const clean = String(token || '').trim()
      const idx = placeholders.indexOf(clean)
      if (idx === -1) return `{{${clean}}}`
      return examples[idx] || `{{${clean}}}`
    },
  )
}

export function summarizePreviewUrl(
  url: string,
  exampleValues: string[],
  mode: PreviewMode,
): string {
  const rendered = applyPreviewMode(url, exampleValues, mode)
  if (rendered.length <= 44) return rendered
  return `${rendered.slice(0, 41)}...`
}

export function buildPreviewWarnings(state: TemplateBuilderState): string[] {
  const warnings: string[] = []
  if (
    state.header.type === 'text' &&
    extractPlaceholders(state.header.text).length > 1
  ) {
    warnings.push('La cabecera de texto solo admite 1 variable.')
  }
  state.buttons.forEach((button, idx) => {
    const placeholders = extractPlaceholders(button.url)
    if (placeholders.length > 1) {
      warnings.push(`El botón URL ${idx + 1} solo admite 1 variable.`)
    } else if (
      placeholders.length === 1 &&
      !/\}\}\s*$/.test(button.url || '')
    ) {
      warnings.push(
        `La variable del botón URL ${idx + 1} debe ir al final.`,
      )
    }
  })
  return warnings
}

export function buildMappingItems(
  scopeLabel: string,
  text: string,
  exampleValues: string[],
): MappingItem[] {
  const placeholders = extractPlaceholders(text)
  const examples = alignExampleValues(exampleValues, placeholders.length)
  return placeholders.map((token, idx) => ({
    scope: scopeLabel,
    token,
    position: idx + 1,
    example: examples[idx] || '',
  }))
}

export function buildAllMappingItems(
  state: TemplateBuilderState,
): MappingItem[] {
  const items: MappingItem[] = []
  if (state.header.type === 'text') {
    items.push(
      ...buildMappingItems(
        'Cabecera',
        state.header.text,
        state.header.exampleValues,
      ),
    )
  }
  items.push(
    ...buildMappingItems('Cuerpo', state.body.text, state.body.exampleValues),
  )
  state.buttons.forEach((button, idx) => {
    items.push(
      ...buildMappingItems(
        `Botón ${idx + 1}`,
        button.url,
        button.exampleValues,
      ),
    )
  })
  return items
}

export function splitPreviewLines(text: string): string[] {
  return String(text || '').split('\n')
}

export type PreviewTokenPart =
  | { type: 'text'; value: string }
  | { type: 'token'; value: string }

export function parsePreviewParts(text: string): PreviewTokenPart[] {
  const parts: PreviewTokenPart[] = []
  const re = /\{\{([^{}]+)\}\}/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', value: text.slice(last, match.index) })
    }
    parts.push({ type: 'token', value: match[0] })
    last = match.index + match[0].length
  }
  if (last < text.length) {
    parts.push({ type: 'text', value: text.slice(last) })
  }
  return parts
}
