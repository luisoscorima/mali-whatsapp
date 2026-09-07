/** Códigos de permiso estables (runtime + ROLE_PERMISSIONS). */
export const PERMISSION = {
  CONVERSATIONS_MANAGE: 'conversations.manage',
  CONVERSATIONS_ASSIGN: 'conversations.assign',
  CONVERSATIONS_STATS_GLOBAL: 'conversations.stats_global',
  CONVERSATIONS_STATS_OWN: 'conversations.stats_own',
  CONVERSATIONS_EXPORT: 'conversations.export',

  CONTACTS_MANAGE: 'contacts.manage',
  CONTACTS_IMPORT: 'contacts.import',
  CONTACTS_EXPORT: 'contacts.export',

  SEGMENTS_LIST: 'segments.list',
  SEGMENTS_MANAGE: 'segments.manage',
  SEGMENTS_VIEW_CONTACTS: 'segments.view_contacts',
  SEGMENTS_ASSIGN: 'segments.assign',
  SEGMENTS_ASSIGN_BULK: 'segments.assign_bulk',

  ATTRIBUTES_LIST: 'attributes.list',
  ATTRIBUTES_MANAGE: 'attributes.manage',
  ATTRIBUTES_ASSIGN: 'attributes.assign',
  ATTRIBUTES_ASSIGN_BULK: 'attributes.assign_bulk',

  CAMPAIGNS_LIST: 'campaigns.list',
  CAMPAIGNS_CREATE: 'campaigns.create',
  CAMPAIGNS_STATS: 'campaigns.stats',

  TEMPLATES_LIST: 'templates.list',
  TEMPLATES_CREATE: 'templates.create',
  TEMPLATES_TOGGLE: 'templates.toggle',
  TEMPLATES_SYNC: 'templates.sync',
  TEMPLATES_STATS: 'templates.stats',
  TEMPLATES_DUPLICATE: 'templates.duplicate',

  FLOWS_LIST: 'flows.list',
  FLOWS_MANAGE: 'flows.manage',
  FLOWS_TOGGLE: 'flows.toggle',

  LEADS_LIST: 'leads.list',

  SETTINGS_INTEGRATION: 'settings.integration',
  SETTINGS_AI_PROMPT: 'settings.ai_prompt',
  SETTINGS_BUSINESS_HOURS: 'settings.business_hours',
  SETTINGS_AUDIT: 'settings.audit',
  SETTINGS_REPORTS: 'settings.reports',
} as const;

export type PermissionCode = (typeof PERMISSION)[keyof typeof PERMISSION];

export const ALL_PERMISSION_CODES: PermissionCode[] = Object.values(PERMISSION);
