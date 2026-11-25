import { io, type Socket } from 'socket.io-client'
import { getToken } from '@/shared/api/token'

/** Campos de la fila del Inbox que usan los consumidores fuera de la bandeja. */
export type InboxPushRow = {
  id: number
  inbox_unread: boolean
  archived: boolean
  assigned_user_id: number | null
  last_user_message_at: string | null
  contact_name: string
  phone: string | null
  wa_profile_name: string | null
  wa_username: string | null
  preview: string
}

/** Mismo payload que `InboxPushPayload` del API (fila con la forma de la lista). */
export type InboxPush<TRow = InboxPushRow> = {
  conversation_id: number
  events: string[]
  conversation: TRow | null
  created_message_ids: number[]
  updated_message_ids: number[]
  unread_changed: boolean
  archived_changed: boolean
}

type StatusListener = (connected: boolean) => void

let socket: Socket | null = null
let sessionKey = ''
let connected = false
const pushListeners = new Set<(push: InboxPush) => void>()
const invalidateListeners = new Set<() => void>()
const statusListeners = new Set<StatusListener>()

function setConnected(next: boolean) {
  if (connected === next) return
  connected = next
  for (const fn of statusListeners) fn(next)
}

/** Una conexión por sesión (usuario + área); reconecta sola con backoff. */
export function connectInboxRealtime(key: string): void {
  if (socket && sessionKey === key) return
  disconnectInboxRealtime()
  sessionKey = key
  const s = io({
    path: '/api/realtime',
    auth: (cb) => cb({ token: getToken() ?? '' }),
    withCredentials: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
  })
  s.on('connect', () => setConnected(true))
  s.on('disconnect', () => setConnected(false))
  s.on('inbox.unauthorized', () => s.disconnect())
  s.on('inbox', (push: InboxPush) => {
    for (const fn of pushListeners) fn(push)
  })
  s.on('inbox.invalidated', () => {
    for (const fn of invalidateListeners) fn()
  })
  socket = s
}

export function disconnectInboxRealtime(): void {
  socket?.removeAllListeners()
  socket?.disconnect()
  socket = null
  sessionKey = ''
  setConnected(false)
}

export function isInboxRealtimeConnected(): boolean {
  return connected
}

export function onInboxPush<TRow = InboxPushRow>(
  fn: (push: InboxPush<TRow>) => void,
): () => void {
  const listener = fn as (push: InboxPush) => void
  pushListeners.add(listener)
  return () => pushListeners.delete(listener)
}

export function onInboxInvalidated(fn: () => void): () => void {
  invalidateListeners.add(fn)
  return () => invalidateListeners.delete(fn)
}

export function onInboxRealtimeStatus(fn: StatusListener): () => void {
  statusListeners.add(fn)
  return () => statusListeners.delete(fn)
}
