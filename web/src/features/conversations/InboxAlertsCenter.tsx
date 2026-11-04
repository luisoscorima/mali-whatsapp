import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { BrowserNotifyPermission } from '@/shared/browserNotify'
import { useCategoryScope } from '@/shared/area/useCategoryScope'
import { useLeadAlerts } from '@/features/leads/leadAlertsContext'
import type { LeadAlertItem } from '@/features/leads/useLeadAlertsNotify'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/shared/ui/shadcn/popover'
import { useOpenContactChat } from '../contacts/openContactChat'

type InboxAlertsCenterProps = {
  browserNotify: {
    supported: boolean
    permission: BrowserNotifyPermission
    active: boolean
    enable: () => Promise<unknown>
    disable: () => void
  }
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

export function InboxAlertsCenter({ browserNotify }: InboxAlertsCenterProps) {
  const navigate = useNavigate()
  const categoryScope = useCategoryScope()
  const { openContactChat, linePickerDialog, busy: openChatBusy } =
    useOpenContactChat({ categoryQuery: categoryScope.query })
  const {
    items: leadItems,
    markRead,
    markAllRead,
    enabled: leadsEnabled,
    toastsEnabled: leadToastsEnabled,
    setToastsEnabled: setLeadToastsEnabled,
  } = useLeadAlerts()
  const [open, setOpen] = useState(false)
  const [markingAll, setMarkingAll] = useState(false)
  const [openingAlertId, setOpeningAlertId] = useState<number | null>(null)

  const badgeCount = leadsEnabled ? leadItems.length : 0

  async function goToLeadChat(alert: LeadAlertItem) {
    if (openingAlertId != null || openChatBusy) return
    setOpeningAlertId(alert.id)
    try {
      if (alert.conversation_id) {
        void markRead(alert.id)
        setOpen(false)
        navigate(`/conversations/${alert.conversation_id}`)
        return
      }
      if (!alert.contact_id) return
      setOpen(false)
      const result = await openContactChat(alert.contact_id, {
        navigateTo: (conversationId) => {
          void markRead(alert.id)
          navigate(`/conversations/${conversationId}`)
        },
      })
      if (result === 'opened' || result === 'same') {
        void markRead(alert.id)
      }
    } finally {
      setOpeningAlertId(null)
    }
  }

  return (
    <div className="inbox-alerts-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`small-btn compact inbox-notify-bell-btn${badgeCount > 0 ? ' has-alerts' : ''}${open ? ' is-active' : ''}`}
            aria-label={
              badgeCount > 0
                ? `Avisos, ${badgeCount} leads pendientes`
                : 'Avisos'
            }
            title={
              badgeCount > 0 ? `${badgeCount} leads pendientes` : 'Avisos de leads'
            }
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
        </PopoverTrigger>
        <PopoverContent
          side="right"
          align="start"
          sideOffset={16}
          collisionPadding={12}
          className="w-80 max-w-[calc(100vw-24px)] max-h-[min(420px,calc(100vh-24px))] overflow-y-auto p-0"
          aria-label="Centro de avisos"
        >
          <div className="border-b border-line px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium">Leads</p>
              {leadsEnabled ? (
                <div className="inbox-alerts-center__actions">
                  <label
                    className="inbox-alerts-center__toggle inbox-alerts-center__toggle--inline"
                    title="Toasts al llegar un lead o sin atender"
                  >
                    <span>Avisos</span>
                    <input
                      type="checkbox"
                      checked={leadToastsEnabled}
                      onChange={(e) => setLeadToastsEnabled(e.target.checked)}
                    />
                  </label>
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
                </div>
              ) : null}
            </div>
          </div>

          <div className="px-3 py-2.5">
            {!leadsEnabled ? (
              <p className="text-xs text-muted">Sin alertas de leads en esta área</p>
            ) : leadItems.length === 0 ? (
              <p className="text-xs text-muted">Sin alertas de leads</p>
            ) : (
              <ul className="inbox-alerts-center__list">
                {leadItems.map((alert) => {
                  const who = alert.contact_name || alert.phone || 'Sin nombre'
                  const opening = openingAlertId === alert.id
                  return (
                    <li key={alert.id} className="inbox-alerts-center__lead">
                      <span className="inbox-alerts-center__title">
                        {leadLabel(alert.event_type, who)}
                      </span>
                      <div className="inbox-alerts-center__actions">
                        <button
                          type="button"
                          className="small-btn compact"
                          disabled={opening || openChatBusy}
                          title={
                            alert.conversation_id
                              ? 'Abrir chat'
                              : 'Abrir o crear chat (elige línea si hay varias)'
                          }
                          onClick={() => void goToLeadChat(alert)}
                        >
                          {opening ? '…' : 'Ir al chat'}
                        </button>
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
          </div>

          {browserNotify.supported ? (
            <div className="border-t border-line px-3 py-2.5">
              <label
                className="inbox-alerts-center__toggle"
                title={
                  browserNotify.permission === 'denied'
                    ? 'Bloqueados en el navegador'
                    : 'Avisos del navegador cuando hay chats sin leer'
                }
              >
                <span>Notificaciones del navegador</span>
                <input
                  type="checkbox"
                  checked={browserNotify.active}
                  disabled={browserNotify.permission === 'denied'}
                  onChange={() => {
                    if (browserNotify.active) browserNotify.disable()
                    else void browserNotify.enable()
                  }}
                />
              </label>
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
      {linePickerDialog}
    </div>
  )
}
