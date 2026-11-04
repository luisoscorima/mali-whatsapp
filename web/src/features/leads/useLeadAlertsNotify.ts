import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { apiClient } from '@/shared/api'
import {
  getBrowserNotifyPermission,
  showBrowserNotification,
} from '@/shared/browserNotify'

const POLL_MS = 15000
const SEEN_STORAGE_KEY = 'mali.leadAlerts.seen'
const SEEN_CAP = 200

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
      title: `Lead sin atender: ${who}`,
      body: 'Pasó el tiempo de primera respuesta. Abre el chat.',
    }
  }
  return {
    title: `Nuevo lead: ${who}`,
    body: 'Oportunidad nueva en tu categoría',
  }
}

function readSeenIds(): Set<number> {
  try {
    const raw = sessionStorage.getItem(SEEN_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return new Set()
    return new Set(
      parsed.filter((id): id is number => typeof id === 'number' && Number.isFinite(id)),
    )
  } catch {
    return new Set()
  }
}

function writeSeenIds(ids: Set<number>) {
  try {
    const trimmed = [...ids].slice(-SEEN_CAP)
    sessionStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(trimmed))
  } catch {
    // ignore quota / private mode
  }
}

/**
 * Polls persistent lead alerts (new + SLA) and shows in-app toast + browser notify.
 */
export function useLeadAlertsNotify(enabled: boolean) {
  const [items, setItems] = useState<LeadAlertItem[]>([])
  const seenRef = useRef<Set<number>>(readSeenIds())
  const navigate = useNavigate()
  const permission = getBrowserNotifyPermission()

  const refresh = useCallback(async () => {
    if (!enabled) return
    const res = await apiClient.get<{ items: LeadAlertItem[] }>(
      '/api/leads/alerts?limit=20',
    )
    if (!res.ok) return
    const next = res.data.items
    setItems(next)

    let seenChanged = false
    for (const alert of next) {
      if (seenRef.current.has(alert.id)) continue
      seenRef.current.add(alert.id)
      seenChanged = true
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
              navigate(href)
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
    if (seenChanged) writeSeenIds(seenRef.current)
  }, [enabled, navigate, permission])

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

  const markAllRead = useCallback(async () => {
    const ids = items.map((item) => item.id)
    if (!ids.length) return
    await Promise.all(
      ids.map((id) => apiClient.post(`/api/leads/alerts/${id}/read`, {})),
    )
    setItems([])
  }, [items])

  return { items, refresh, markRead, markAllRead }
}
