export type TemplateBuilderState = {
  header: {
    type: string
    text: string
    exampleValues: string[]
    exampleMediaUrl: string
    exampleHandle: string
  }
  body: {
    text: string
    exampleValues: string[]
  }
  footer: {
    text: string
  }
  buttons: {
    type: string
    text: string
    /** QUICK_REPLY: trigger del flujo (payload de webhook). */
    payload: string
    url: string
    exampleValues: string[]
  }[]
}

export const TEMPLATE_NAME_REGEX = /^[a-z0-9_]{1,128}$/
/** Límite de Meta para el BODY de plantillas. */
export const BODY_TEXT_MAX_LEN = 1024

export const EMPTY_BUILDER: TemplateBuilderState = {
  header: {
    type: 'none',
    text: '',
    exampleValues: [],
    exampleMediaUrl: '',
    exampleHandle: '',
  },
  body: { text: '', exampleValues: [] },
  footer: { text: '' },
  buttons: [],
}

export function countPlaceholders(text: string): number {
  const tokens: string[] = []
  const re = /\{\{([^{}]+)\}\}/g
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    tokens.push(match[1])
  }
  if (!tokens.length) return 0

  const numeric = tokens.every((t) => /^\d+$/.test(t))
  if (numeric) {
    const order: number[] = []
    const seen = new Set<number>()
    for (const token of tokens) {
      const num = Number(token)
      if (!seen.has(num)) {
        seen.add(num)
        order.push(num)
      }
    }
    return order.length
  }
  const aliases = new Set(tokens)
  return aliases.size
}

export function ensureExampleValues(
  current: string[],
  count: number,
): string[] {
  const out = [...current]
  while (out.length < count) out.push('')
  return out.slice(0, count)
}

export function normalizeTemplateNameInput(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')
    .slice(0, 128)
}
