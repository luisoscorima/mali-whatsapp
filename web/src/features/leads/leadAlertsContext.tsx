import { createContext, useContext, type ReactNode } from 'react'
import type { AuthUser } from '@/shared/api'
import { PERMISSION, userHasPermission } from '@/shared/auth/permissions'
import { canonicalArea } from '@/shared/area/category-selection'
import {
  useLeadAlertsNotify,
  type LeadAlertItem,
} from './useLeadAlertsNotify'

type LeadAlertsContextValue = {
  items: LeadAlertItem[]
  refresh: () => Promise<void>
  markRead: (alertId: number) => Promise<void>
  markAllRead: () => Promise<void>
  enabled: boolean
  toastsEnabled: boolean
  setToastsEnabled: (on: boolean) => void
}

const LeadAlertsContext = createContext<LeadAlertsContextValue | null>(null)

export function educationLeadAlertsEnabled(user: AuthUser | null): boolean {
  if (!user) return false
  if (!userHasPermission(user, PERMISSION.LEADS_LIST) && !user.canManageLeads) {
    return false
  }
  // Solo con área activa Educación (no por membresía multiárea en PAM/otras).
  return canonicalArea(user.area) === 'educacion'
}

export function LeadAlertsProvider({
  user,
  children,
}: {
  user: AuthUser | null
  children: ReactNode
}) {
  const enabled = educationLeadAlertsEnabled(user)
  const value = useLeadAlertsNotify(enabled)
  return (
    <LeadAlertsContext.Provider value={{ ...value, enabled }}>
      {children}
    </LeadAlertsContext.Provider>
  )
}

export function useLeadAlerts(): LeadAlertsContextValue {
  const ctx = useContext(LeadAlertsContext)
  if (!ctx) {
    return {
      items: [],
      refresh: async () => undefined,
      markRead: async () => undefined,
      markAllRead: async () => undefined,
      enabled: false,
      toastsEnabled: false,
      setToastsEnabled: () => undefined,
    }
  }
  return ctx
}
