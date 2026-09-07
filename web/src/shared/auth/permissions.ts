import type { AuthUser } from '@/shared/api'

/** Códigos alineados a api/src/auth/roles/permission-codes.ts */
export const PERMISSION = {
  CONVERSATIONS_MANAGE: 'conversations.manage',
  CONVERSATIONS_ASSIGN: 'conversations.assign',
  CONVERSATIONS_STATS_GLOBAL: 'conversations.stats_global',
  CONVERSATIONS_EXPORT: 'conversations.export',
  CONTACTS_MANAGE: 'contacts.manage',
  CONTACTS_CREATE: 'contacts.create',
  CONTACTS_UPDATE: 'contacts.update',
  CONTACTS_IMPORT: 'contacts.import',
  CONTACTS_EXPORT: 'contacts.export',
  SEGMENTS_LIST: 'segments.list',
  SEGMENTS_MANAGE: 'segments.manage',
  ATTRIBUTES_LIST: 'attributes.list',
  ATTRIBUTES_MANAGE: 'attributes.manage',
  CAMPAIGNS_LIST: 'campaigns.list',
  CAMPAIGNS_CREATE: 'campaigns.create',
  CAMPAIGNS_STATS: 'campaigns.stats',
  TEMPLATES_LIST: 'templates.list',
  TEMPLATES_CREATE: 'templates.create',
  FLOWS_LIST: 'flows.list',
  FLOWS_MANAGE: 'flows.manage',
  LEADS_LIST: 'leads.list',
  SETTINGS_INTEGRATION: 'settings.integration',
  SETTINGS_AI_PROMPT: 'settings.ai_prompt',
  SETTINGS_BUSINESS_HOURS: 'settings.business_hours',
  SETTINGS_AUDIT: 'settings.audit',
  SETTINGS_REPORTS: 'settings.reports',
} as const

export function userHasPermission(
  user: AuthUser | null | undefined,
  code: string,
): boolean {
  if (!user) return false
  if (user.isMaster || user.isBootstrapAdmin) return true
  if (Array.isArray(user.permissions) && user.permissions.length > 0) {
    return user.permissions.includes(code)
  }
  // Sesión antigua sin permissions[]: aproximar con flags legacy
  if (code === PERMISSION.LEADS_LIST) return Boolean(user.canManageLeads)
  if (code === PERMISSION.SEGMENTS_MANAGE || code === PERMISSION.SEGMENTS_LIST) {
    return Boolean(user.canManageSegments)
  }
  if (
    code === PERMISSION.ATTRIBUTES_MANAGE ||
    code === PERMISSION.ATTRIBUTES_LIST
  ) {
    return Boolean(user.canManageAttributes)
  }
  if (code === PERMISSION.CAMPAIGNS_STATS) {
    return Boolean(user.canViewCampaignStats)
  }
  if (code === PERMISSION.CONVERSATIONS_STATS_GLOBAL) {
    return Boolean(user.canViewConversationStats)
  }
  if (code === PERMISSION.CONVERSATIONS_ASSIGN) {
    return Boolean(user.canAssignConversations)
  }
  if (code === PERMISSION.SETTINGS_AI_PROMPT) {
    return Boolean(user.canEditAiPrompt)
  }
  if (code === PERMISSION.SETTINGS_AUDIT) return Boolean(user.canViewAuditLogs)
  if (code === PERMISSION.SETTINGS_INTEGRATION) {
    return Boolean(user.canViewIntegration)
  }
  if (code === PERMISSION.SETTINGS_BUSINESS_HOURS) {
    return Boolean(user.canEditBusinessHours)
  }
  if (code === PERMISSION.SETTINGS_REPORTS) return Boolean(user.canViewReports)
  // Sin rol migrado: acceso histórico amplio
  return true
}

export function userCanCreateContacts(
  user: AuthUser | null | undefined,
): boolean {
  return (
    userHasPermission(user, PERMISSION.CONTACTS_MANAGE) ||
    userHasPermission(user, PERMISSION.CONTACTS_CREATE)
  )
}

export function userCanUpdateContacts(
  user: AuthUser | null | undefined,
): boolean {
  return (
    userHasPermission(user, PERMISSION.CONTACTS_MANAGE) ||
    userHasPermission(user, PERMISSION.CONTACTS_UPDATE)
  )
}

export function defaultHomePath(user: AuthUser | null | undefined): string {
  if (!user) return '/conversations'
  if (userHasPermission(user, PERMISSION.CONVERSATIONS_MANAGE)) {
    return '/conversations'
  }
  if (userHasPermission(user, PERMISSION.CAMPAIGNS_LIST)) return '/campaigns'
  if (userHasPermission(user, PERMISSION.CONTACTS_MANAGE)) return '/contacts'
  if (userHasPermission(user, PERMISSION.TEMPLATES_LIST)) return '/templates'
  if (userHasPermission(user, PERMISSION.LEADS_LIST)) return '/leads'
  if (userHasPermission(user, PERMISSION.FLOWS_LIST)) return '/flows'
  return '/settings'
}

export const ROLE_OPTIONS = [
  { slug: 'asesor_comercial', label: 'Asesor comercial' },
  { slug: 'analista', label: 'Analista' },
  { slug: 'gestor', label: 'Gestor' },
  { slug: 'supervisor', label: 'Supervisor' },
  { slug: 'coordinador', label: 'Coordinador' },
  { slug: 'master', label: 'Master (TI)' },
] as const
