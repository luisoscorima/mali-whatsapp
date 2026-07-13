import type { ReactNode } from 'react'
import { createElement, Fragment } from 'react'

export type WaFormatPart =
  | { type: 'text'; value: string }
  | { type: 'bold'; value: string }
  | { type: 'italic'; value: string }

/**
 * Parse WhatsApp-style *bold* and _italic_. Conservatively skips empty
 * markers and does not nest formats. Placeholders like {{var}} stay plain text.
 */
export function parseWhatsAppFormat(text: string): WaFormatPart[] {
  const source = String(text || '')
  if (!source) return []

  const parts: WaFormatPart[] = []
  // Non-greedy, no newlines inside markers; prefer longer matches left-to-right
  const re = /(\*[^*\n]+?\*)|(_[^_\n]+?_)/g
  let last = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(source)) !== null) {
    if (match.index > last) {
      parts.push({ type: 'text', value: source.slice(last, match.index) })
    }
    const raw = match[0]
    if (raw.startsWith('*') && raw.endsWith('*')) {
      parts.push({ type: 'bold', value: raw.slice(1, -1) })
    } else {
      parts.push({ type: 'italic', value: raw.slice(1, -1) })
    }
    last = match.index + raw.length
  }

  if (last < source.length) {
    parts.push({ type: 'text', value: source.slice(last) })
  }

  return parts.length ? parts : [{ type: 'text', value: source }]
}

function renderHighlight(
  text: string,
  query: string,
  keyPrefix: string,
): ReactNode {
  const q = String(query || '').trim()
  if (!q) return text
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'))
  if (parts.length === 1) return text
  return parts.map((part, index) =>
    part.toLowerCase() === q.toLowerCase()
      ? createElement(
          'mark',
          { key: `${keyPrefix}-m-${index}`, className: 'chat-bubble__highlight' },
          part,
        )
      : part,
  )
}

/** Render WA format as React nodes; optional search highlight inside text nodes. */
export function renderWhatsAppText(
  text: string,
  highlightQuery = '',
): ReactNode {
  const parts = parseWhatsAppFormat(text)
  return parts.map((part, i) => {
    const key = `wa-${i}`
    if (part.type === 'bold') {
      return createElement(
        'strong',
        { key },
        renderHighlight(part.value, highlightQuery, key),
      )
    }
    if (part.type === 'italic') {
      return createElement(
        'em',
        { key },
        renderHighlight(part.value, highlightQuery, key),
      )
    }
    return createElement(
      Fragment,
      { key },
      renderHighlight(part.value, highlightQuery, key),
    )
  })
}
