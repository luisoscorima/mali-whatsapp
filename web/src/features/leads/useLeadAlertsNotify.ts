import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '@/shared/api'
import {
  getBrowserNotifyPermission,
  showBrowserNotification,
} from '@/shared/browserNotify'

const POLL_MS = 15000

type LeadAlertItem = {
  id: number
  cycle_id: number
  area: string
  created_at: string
  contact_id: number
  contact_name: string
  phone: string | null
  assigned_user_id: number | null
}

/**
 * Polls persistent new-lead alerts (with or without chat) and shows in-app + browser notify.
 */
export function useLeadAlertsNotify(enabled: boolean) {
  const [items, setItems] = useState<LeadAlertItem[]>([])
  const seenRef = useRef<Set<number>>(new Set())
  const permission = getBrowserNotifyPermission()

  const refresh = useCallback(async () => {
    if (!enabled) return
    const res = await apiClient.get<{ items: LeadAlertItem[] }>('/api/leads/alerts?limit=20')
    if (!res.ok) return
    const next = res.data.items
    setItems(next)
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      for (const alert of next) {
        if (seenRef.current.has(alert.id)) continue
        seenRef.current.add(alert.id)
        if (permission === 'granted') {
          showBrowserNotification({
            title: `Nuevo lead: ${alert.contact_name || alert.phone || 'Sin nombre'}`,
            body: 'Oportunidad nueva en tu categoría',
            tag: `lead-alert-${alert.id}`,
          })
        }
      }
    }
  }, [enabled, permission])

  useEffect(() => {
    if (!enabled) return
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
