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
): string {
  return template.replace(
    /\{\{\s*([A-Za-z][A-Za-z0-9_.]*)\s*\}\}/g,
    (_m, key: string) => {
      if (key === CONTACT_NAME_KEY) return contact.name.trim()
      if (key === CONTACT_PHONE_KEY) return contact.phone.trim()
      if (key === CONTACT_EMAIL_KEY) {
        const native = contact.email.trim()
        if (native) return native
        return String(attrs.email || attrs.correo || '').trim()
      }
      if (key === CONTACT_DNI_KEY) {
        const native = contact.dni.trim()
        if (native) return native
        return String(attrs.dni || '').trim()
      }
      const v = attrs[key]
      return v != null && String(v).trim() ? String(v) : ''
    },
  )
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
