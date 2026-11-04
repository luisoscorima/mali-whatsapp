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
  enabled: boolean
}

const LeadAlertsContext = createContext<LeadAlertsContextValue | null>(null)

export function educationLeadAlertsEnabled(user: AuthUser | null): boolean {
  if (!user) return false
  if (!userHasPermission(user, PERMISSION.LEADS_LIST) && !user.canManageLeads) {
    return false
  }
  if (canonicalArea(user.area) === 'educacion') return true
  return (user.allowedAreas ?? []).some(
    (area) => canonicalArea(area) === 'educacion',
  )
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
      enabled: false,
    }
  }
  return ctx
}
