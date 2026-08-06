import { useCallback, useEffect, useRef, useState } from 'react'
import { apiClient } from '@/shared/api'
import {
  getBrowserNotifyPermission,
  requestBrowserNotifyPermission,
  showBrowserNotification,
  type BrowserNotifyPermission,
} from '@/shared/browserNotify'
import { notify } from '@/shared/notify'

const MINE_NOTIFY_POLL_MS = 8000

type MineListItem = {
  id: number
  phone: string
  last_message_at: string | null
  inbox_unread: boolean
  contact_name: string
  wa_profile_name: string | null
  preview: string
  is_virtual: boolean
  archived: boolean
}

type MineListResult = {
  items: MineListItem[]
}

function itemDisplayName(item: MineListItem): string {
  const crmName = String(item.contact_name ?? '').trim()
  const waAlias = String(item.wa_profile_name ?? '').trim()
  return crmName || waAlias || item.phone
}

/**
 * Avisos del navegador para chats asignados (filtro mine) cuando la pestaña está en segundo plano.
 */
export function useAssignedInboxBrowserNotify(opts: {
  userId: number | null | undefined
  selectedConversationId: number | null
  onOpenConversation: (conversationId: number) => void
}) {
  const { userId, selectedConversationId, onOpenConversation } = opts
  const [permission, setPermission] = useState<BrowserNotifyPermission>(() =>
    getBrowserNotifyPermission(),
  )
  const selectedIdRef = useRef(selectedConversationId)
  const onOpenRef = useRef(onOpenConversation)
  selectedIdRef.current = selectedConversationId
  onOpenRef.current = onOpenConversation

  const enable = useCallback(async () => {
    const next = await requestBrowserNotifyPermission()
    setPermission(next)
    if (next === 'granted') {
      notify.success('Avisos de Mis chats activados')
    } else if (next === 'denied') {
      notify.error('El navegador bloqueó las notificaciones')
    }
    return next
  }, [])

  useEffect(() => {
    if (!userId || permission !== 'granted') return

    const baseline = new Map<number, string | null>()
    let seeded = false
    let cancelled = false
    let inFlight = false

    async function pollMine() {
      if (cancelled || inFlight) return
      inFlight = true
      try {
        const result = await apiClient.get<MineListResult>(
          '/api/conversations?chat=mine&page=1',
        )
        if (!result.ok || cancelled) return

        const items = result.data.items ?? []
        if (!seeded) {
          for (const item of items) {
            if (item.is_virtual) continue
            baseline.set(item.id, item.last_message_at)
          }
          seeded = true
          return
        }

        const tabHidden = document.visibilityState === 'hidden'
        const openId = selectedIdRef.current

        for (const item of items) {
          if (item.is_virtual || item.archived) continue

          const prevAt = baseline.get(item.id)
          const nextAt = item.last_message_at
          baseline.set(item.id, nextAt)

          if (!item.inbox_unread) continue
          if (!tabHidden) continue
          if (openId != null && openId === item.id) continue

          const isNewInList = prevAt === undefined
          const messageChanged = nextAt != null && nextAt !== prevAt
          if (!isNewInList && !messageChanged) continue

          const preview = String(item.preview ?? '').trim()
          showBrowserNotification({
            title: itemDisplayName(item),
            body: preview || 'Nuevo mensaje',
            tag: `inbox-mine-${item.id}`,
            onClick: () => onOpenRef.current(item.id),
          })
        }
      } finally {
        inFlight = false
      }
    }

    void pollMine()
    const timer = window.setInterval(() => void pollMine(), MINE_NOTIFY_POLL_MS)
    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') void pollMine()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [userId, permission])

  return {
    permission,
    enable,
    supported: permission !== 'unsupported',
  }
}
