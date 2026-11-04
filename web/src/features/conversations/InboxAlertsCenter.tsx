import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { apiClient } from '@/shared/api'
import type { BrowserNotifyPermission } from '@/shared/browserNotify'
import { useLeadAlerts } from '@/features/leads/leadAlertsContext'
import { chatDisplayName } from './whatsappIdentity'

type UnreadChatItem = {
  id: number
  phone: string | null
  contact_name: string
  wa_profile_name: string | null
  wa_username: string | null
  preview: string
  inbox_unread: boolean
  is_virtual: boolean
  archived: boolean
}

type InboxAlertsCenterProps = {
  unreadCount: number
  browserNotify: {
    supported: boolean
    permission: BrowserNotifyPermission
    active: boolean
    enable: () => Promise<unknown>
    disable: () => void
  }
  onOpenConversation: (conversationId: number) => void
}

function BellIcon({ filled }: { filled?: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  )
}

function leadLabel(eventType: string | undefined, name: string): string {
  if (eventType === 'sla_first_reply') return `Sin atender · ${name}`
  return `Nuevo · ${name}`
}

export function InboxAlertsCenter({
  unreadCount,
  browserNotify,
  onOpenConversation,
}: InboxAlertsCenterProps) {
  const {
    items: leadItems,
    markRead,
    markAllRead,
    enabled: leadsEnabled,
  } = useLeadAlerts()
  const [open, setOpen] = useState(false)
  const [unreadChats, setUnreadChats] = useState<UnreadChatItem[]>([])
  const [markingAll, setMarkingAll] = useState(false)
  const [panelPos, setPanelPos] = useState<{ top: number; left: number } | null>(
    null,
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const leadCount = leadsEnabled ? leadItems.length : 0
  const badgeCount = unreadCount + leadCount

  useLayoutEffect(() => {
    if (!open) {
      setPanelPos(null)
      return
    }
    function place() {
      const anchor = rootRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const width = Math.min(340, window.innerWidth * 0.85)
      const left = Math.min(
        Math.max(8, rect.left),
        Math.max(8, window.innerWidth - width - 8),
      )
      setPanelPos({ top: rect.bottom + 6, left })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onDocClick(ev: MouseEvent) {
      const target = ev.target as Node
      if (rootRef.current?.contains(target)) return
      if (panelRef.current?.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('click', onDocClick)
    return () => document.removeEventListener('click', onDocClick)
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    void (async () => {
      const res = await apiClient.get<{ items: UnreadChatItem[] }>(
        '/api/conversations?chat=unread&page=1',
      )
      if (cancelled || !res.ok) return
      setUnreadChats(
        (res.data.items ?? []).filter(
          (item) => !item.is_virtual && !item.archived && item.inbox_unread,
        ),
      )
    })()
    return () => {
      cancelled = true
    }
  }, [open, unreadCount])

  return (
    <div className="inbox-alerts-center" ref={rootRef}>
      <button
        type="button"
        className={`small-btn compact inbox-notify-bell-btn${badgeCount > 0 ? ' has-alerts' : ''}${open ? ' is-active' : ''}`}
        aria-expanded={open}
        aria-label={
          badgeCount > 0
            ? `Avisos, ${badgeCount} pendientes`
            : 'Avisos'
        }
        title="Avisos"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="inbox-alerts-center__icon-wrap">
          <BellIcon filled={badgeCount > 0} />
          {badgeCount > 0 ? (
            <span className="inbox-alerts-center__badge">
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          ) : null}
        </span>
      </button>

      {open && panelPos
        ? createPortal(
            <div
              ref={panelRef}
              className="inbox-alerts-center__panel"
              role="dialog"
              aria-label="Centro de avisos"
              style={{ top: panelPos.top, left: panelPos.left }}
            >
              {leadsEnabled ? (
                <section className="inbox-alerts-center__section">
                  <header className="inbox-alerts-center__section-head">
                    <h3>Leads</h3>
                    {leadItems.length > 0 ? (
                      <button
                        type="button"
                        className="small-btn compact"
                        disabled={markingAll}
                        onClick={() => {
                          setMarkingAll(true)
                          void markAllRead().finally(() => setMarkingAll(false))
                        }}
                      >
                        {markingAll ? '…' : 'Listo a todos'}
                      </button>
                    ) : null}
                  </header>
                  {leadItems.length === 0 ? (
                    <p className="inbox-alerts-center__empty muted">
                      Sin alertas de leads
                    </p>
                  ) : (
                    <ul className="inbox-alerts-center__list">
                      {leadItems.map((alert) => {
                        const who =
                          alert.contact_name || alert.phone || 'Sin nombre'
                        const href = alert.conversation_id
                          ? `/conversations/${alert.conversation_id}`
                          : '/conversations'
                        return (
                          <li
                            key={alert.id}
                            className="inbox-alerts-center__lead"
                          >
                            <span className="inbox-alerts-center__title">
                              {leadLabel(alert.event_type, who)}
                            </span>
                            <div className="inbox-alerts-center__actions">
                              <Link
                                to={href}
                                className="small-btn compact"
                                onClick={() => {
                                  void markRead(alert.id)
                                  setOpen(false)
                                }}
                              >
                                Ir al chat
                              </Link>
                              <button
                                type="button"
                                className="small-btn compact"
                                onClick={() => void markRead(alert.id)}
                              >
                                Listo
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              ) : null}

              <section className="inbox-alerts-center__section">
                <header className="inbox-alerts-center__section-head">
                  <h3>Chats</h3>
                  {browserNotify.supported ? (
                    <label className="inbox-alerts-center__toggle inbox-alerts-center__toggle--inline">
                      <span>Avisos</span>
                      <input
                        type="checkbox"
                        checked={browserNotify.active}
                        disabled={browserNotify.permission === 'denied'}
                        title={
                          browserNotify.permission === 'denied'
                            ? 'Bloqueados en el navegador'
                            : 'Notificaciones del navegador'
                        }
                        onChange={() => {
                          if (browserNotify.active) browserNotify.disable()
                          else void browserNotify.enable()
                        }}
                      />
                    </label>
                  ) : null}
                </header>
                {unreadChats.length === 0 ? (
                  <p className="inbox-alerts-center__empty muted">
                    Sin chats sin leer
                  </p>
                ) : (
                  <ul className="inbox-alerts-center__list">
                    {unreadChats.slice(0, 5).map((item) => {
                      const name = chatDisplayName({
                        phone: item.phone,
                        contactName: item.contact_name,
                        profileName: item.wa_profile_name,
                        username: item.wa_username,
                      })
                      return (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="inbox-alerts-center__row-btn"
                            onClick={() => {
                              onOpenConversation(item.id)
                              setOpen(false)
                            }}
                          >
                            <span className="inbox-alerts-center__title">
                              {name}
                            </span>
                            <span className="inbox-alerts-center__preview muted">
                              {item.preview || 'Nuevo mensaje'}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
