import { useCallback, useRef, useState } from 'react'
import { apiClient } from '@/shared/api'
import { notify } from '@/shared/notify'

export type AdvisorNote = {
  id: number
  title: string
  body: string
  sort_order: number
}

export const CONTACT_NAME_KEY = 'contact.name'
export const CONTACT_PHONE_KEY = 'contact.phone'
export const CONTACT_EMAIL_KEY = 'contact.email'
export const CONTACT_DNI_KEY = 'contact.dni'

export function resolveNotePlaceholders(
  template: string,
  attrs: Record<string, string>,
  contact: {
    name: string
    phone: string
    email: string
    dni: string
  },
): { text: string; missing: string[] } {
  const missing = new Set<string>()
  const values: Record<string, string> = {
    ...attrs,
    [CONTACT_NAME_KEY]: contact.name,
    [CONTACT_PHONE_KEY]: contact.phone,
    [CONTACT_EMAIL_KEY]: contact.email.trim() || attrs.email?.trim() || attrs.correo || '',
    [CONTACT_DNI_KEY]: contact.dni.trim() || attrs.dni || '',
  }
  const text = template.replace(
    /\{\{\s*([A-Za-z0-9_][A-Za-z0-9_.]*)\s*\}\}/g,
    (placeholder, key: string) => {
      const value = Object.hasOwn(values, key) ? values[key].trim() : ''
      if (value) return value
      missing.add(key)
      return placeholder
    },
  )
  return { text, missing: [...missing] }
}

export function useAdvisorNotes() {
  const [notes, setNotes] = useState<AdvisorNote[]>([])
  const [loading, setLoading] = useState(false)
  const requestId = useRef(0)
  const loadNotes = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    const result = await apiClient.get<AdvisorNote[]>('/api/advisor-notes').catch(() => ({
      ok: false as const,
      error: 'No se pudieron cargar las respuestas rápidas.',
    }))
    if (id !== requestId.current) return
    setLoading(false)
    if (result.ok) setNotes(result.data)
    else notify.error(result.error)
  }, [])

  return { notes, loading, loadNotes }
}
