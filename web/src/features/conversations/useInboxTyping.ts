import { useEffect, useRef, useState } from 'react'
import {
  onInboxRealtimeStatus,
  onInboxTyping,
  sendInboxTyping,
  watchInboxTyping,
} from '@/shared/realtime/inboxRealtime'

const TYPING_REFRESH_MS = 1250
const TYPING_IDLE_MS = 3500
const TYPING_EXPIRY_MS = 5000

export function useInboxTyping(conversationId: number | null, advisorId: number | undefined) {
  const [typing, setTyping] = useState<{ conversationId: number; names: string[] } | null>(null)
  const outgoingTimer = useRef<number | undefined>(undefined)
  const lastSent = useRef(0)

  useEffect(() => {
    if (!conversationId || advisorId == null) return
    const active = new Map<string, { advisorId: number; label: string; timer: number }>()

    function updateNames() {
      if (!conversationId) return
      const names = new Map([...active.values()].map((entry) => [entry.advisorId, entry.label]))
      setTyping(names.size ? { conversationId, names: [...names.values()] } : null)
    }

    function clear() {
      for (const entry of active.values()) window.clearTimeout(entry.timer)
      active.clear()
      window.clearTimeout(outgoingTimer.current)
      lastSent.current = 0
      setTyping(null)
    }

    const offStatus = onInboxRealtimeStatus((connected) => {
      if (!connected) clear()
    })
    const offTyping = onInboxTyping((event) => {
      if (event.conversationId !== conversationId || event.advisorId === advisorId) return
      window.clearTimeout(active.get(event.connectionId)?.timer)
      if (event.active) {
        const timer = window.setTimeout(() => {
          active.delete(event.connectionId)
          updateNames()
        }, TYPING_EXPIRY_MS)
        active.set(event.connectionId, { advisorId: event.advisorId, label: event.label, timer })
      } else {
        active.delete(event.connectionId)
      }
      updateNames()
    })
    watchInboxTyping(conversationId)

    return () => {
      offStatus()
      offTyping()
      watchInboxTyping(null)
      clear()
    }
  }, [conversationId, advisorId])

  function stopTyping() {
    window.clearTimeout(outgoingTimer.current)
    if (conversationId && lastSent.current) sendInboxTyping(conversationId, false)
    lastSent.current = 0
  }

  function signalTyping(text: string) {
    if (!conversationId || !text.trim()) {
      stopTyping()
      return
    }
    const now = Date.now()
    if (now - lastSent.current >= TYPING_REFRESH_MS) {
      sendInboxTyping(conversationId, true)
      lastSent.current = now
    }
    window.clearTimeout(outgoingTimer.current)
    outgoingTimer.current = window.setTimeout(stopTyping, TYPING_IDLE_MS)
  }

  return {
    names: typing && typing.conversationId === conversationId ? typing.names : [],
    signalTyping,
    stopTyping,
  }
}
