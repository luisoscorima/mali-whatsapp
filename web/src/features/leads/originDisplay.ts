/** Campos útiles del payload de orígenes (widget Educación, etc.). */
export type OriginPayload = {
  curso?: unknown
  curso_url?: unknown
  fuente?: unknown
  source?: unknown
  programa?: unknown
  educacion_lead_id?: unknown
}

export type OriginLike = {
  channel: string
  source_key?: string | null
  source_label?: string | null
  external_id?: string
  payload?: unknown
  last_seen_at?: string
  first_seen_at?: string
}

export type ContactOriginSummary = OriginLike & {
  id: number
  external_id: string
  first_seen_at: string
  last_seen_at: string
}

function asText(value: unknown): string {
  if (value == null) return ''
  const s = String(value).trim()
  return s
}

export function parseOriginPayload(payload: unknown): OriginPayload {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {}
  }
  return payload as OriginPayload
}

/** Etiquetas principales para listados / ficha. */
export function originPrimaryFields(origin: OriginLike) {
  const p = parseOriginPayload(origin.payload)
  return {
    curso: asText(p.curso),
    cursoUrl: asText(p.curso_url),
    fuente: asText(p.fuente) || asText(origin.source_label),
    programa: asText(p.programa),
  }
}

/** Secundarios: siguen en BD; se muestran con menos énfasis. */
export function originSecondaryFields(origin: OriginLike) {
  const p = parseOriginPayload(origin.payload)
  return {
    source: asText(p.source) || asText(origin.source_key),
    leadId: asText(p.educacion_lead_id),
  }
}

export function channelLabel(channel: string): string {
  const map: Record<string, string> = {
    widget: 'Widget web',
    meta_lead_form: 'Instant Forms',
    meta_ctwa: 'Click-to-WhatsApp',
    organic_wa: 'WhatsApp orgánico',
    manual: 'Manual',
    import: 'Import',
    tiktok: 'TikTok',
    other: 'Otros',
  }
  return map[channel] || channel
}
