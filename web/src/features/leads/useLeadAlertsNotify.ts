import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { apiClient } from '@/shared/api'
import {
  getBrowserNotifyPermission,
  showBrowserNotification,
} from '@/shared/browserNotify'

const POLL_MS = 15000

export type LeadAlertEventType = 'new_lead' | 'sla_first_reply' | string

export type LeadAlertItem = {
  id: number
  cycle_id: number
  area: string
  event_type?: LeadAlertEventType
  created_at: string
  contact_id: number
  contact_name: string
  phone: string | null
  assigned_user_id: number | null
  conversation_id?: number | null
}

function alertCopy(alert: LeadAlertItem): { title: string; body: string } {
  const who = alert.contact_name || alert.phone || 'Sin nombre'
  if (alert.event_type === 'sla_first_reply') {
    return {
      title: `Lead sin atender (+10 min): ${who}`,
      body: 'Primera respuesta fuera de SLA. Abre el chat.',
    }
  }
  return {
    title: `Nuevo lead: ${who}`,
    body: 'Oportunidad nueva en tu categoría',
  }
}

/**
 * Polls persistent lead alerts (new + SLA) and shows in-app toast + browser notify.
 */
export function useLeadAlertsNotify(enabled: boolean) {
  const [items, setItems] = useState<LeadAlertItem[]>([])
  const seenRef = useRef<Set<number>>(new Set())
  const permission = getBrowserNotifyPermission()

  const refresh = useCallback(async () => {
    if (!enabled) return
    const res = await apiClient.get<{ items: LeadAlertItem[] }>(
      '/api/leads/alerts?limit=20',
    )
    if (!res.ok) return
    const next = res.data.items
    setItems(next)

    for (const alert of next) {
      if (seenRef.current.has(alert.id)) continue
      seenRef.current.add(alert.id)
      const copy = alertCopy(alert)
      const href = alert.conversation_id
        ? `/conversations/${alert.conversation_id}`
        : '/conversations'

      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        toast.message(copy.title, {
          description: copy.body,
          duration: 8000,
          action: {
            label: 'Ir al chat',
            onClick: () => {
              window.location.assign(href)
            },
          },
        })
      } else if (permission === 'granted') {
        showBrowserNotification({
          title: copy.title,
          body: copy.body,
          tag: `lead-alert-${alert.id}`,
        })
      }
    }
  }, [enabled, permission])

  useEffect(() => {
    if (!enabled) {
      setItems([])
      return
    }
    void refresh()
    const id = window.setInterval(() => void refresh(), POLL_MS)
    return () => window.clearInterval(id)
  }, [enabled, refresh])

  const markRead = useCallback(async (alertId: number) => {
    await apiClient.post(`/api/leads/alerts/${alertId}/read`, {})
    setItems((prev) => prev.filter((item) => item.id !== alertId))
  }, [])

  return { items, refresh, markRead }
}
