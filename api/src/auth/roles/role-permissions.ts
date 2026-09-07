import {
  ALL_PERMISSION_CODES,
  PERMISSION,
  type PermissionCode,
} from './permission-codes';

export const ROLE_SLUGS = [
  'asesor_comercial',
  'analista',
  'gestor',
  'supervisor',
  'coordinador',
  'master',
] as const;

export type RoleSlug = (typeof ROLE_SLUGS)[number];

export const ROLE_LABELS: Record<RoleSlug, string> = {
  asesor_comercial: 'Asesor comercial',
  analista: 'Analista',
  gestor: 'Gestor',
  supervisor: 'Supervisor',
  coordinador: 'Coordinador',
  master: 'Master (TI)',
};

export function isRoleSlug(value: unknown): value is RoleSlug {
  return (
    typeof value === 'string' &&
    (ROLE_SLUGS as readonly string[]).includes(value)
  );
}

function uniq(codes: PermissionCode[]): PermissionCode[] {
  return [...new Set(codes)];
}

const ASESOR: PermissionCode[] = [
  PERMISSION.CONVERSATIONS_MANAGE,
  PERMISSION.CONVERSATIONS_STATS_OWN,
  PERMISSION.CONTACTS_CREATE,
  PERMISSION.CONTACTS_UPDATE,
  PERMISSION.SEGMENTS_LIST,
  PERMISSION.SEGMENTS_ASSIGN,
  PERMISSION.ATTRIBUTES_ASSIGN,
];

const ANALISTA: PermissionCode[] = [
  PERMISSION.CONVERSATIONS_STATS_GLOBAL,
  PERMISSION.CONVERSATIONS_EXPORT,
  PERMISSION.CONTACTS_MANAGE,
  PERMISSION.CONTACTS_EXPORT,
  PERMISSION.SEGMENTS_LIST,
  PERMISSION.SEGMENTS_ASSIGN_BULK,
  PERMISSION.ATTRIBUTES_ASSIGN_BULK,
  PERMISSION.CAMPAIGNS_STATS,
  PERMISSION.TEMPLATES_STATS,
  PERMISSION.LEADS_LIST,
  PERMISSION.SETTINGS_INTEGRATION,
  PERMISSION.SETTINGS_AUDIT,
  PERMISSION.SETTINGS_REPORTS,
];

const GESTOR: PermissionCode[] = [
  PERMISSION.CONTACTS_MANAGE,
  PERMISSION.SEGMENTS_LIST,
  PERMISSION.SEGMENTS_MANAGE,
  PERMISSION.SEGMENTS_VIEW_CONTACTS,
  PERMISSION.SEGMENTS_ASSIGN,
  PERMISSION.SEGMENTS_ASSIGN_BULK,
  PERMISSION.ATTRIBUTES_LIST,
  PERMISSION.ATTRIBUTES_ASSIGN,
  PERMISSION.ATTRIBUTES_ASSIGN_BULK,
  PERMISSION.CAMPAIGNS_LIST,
  PERMISSION.CAMPAIGNS_CREATE,
  PERMISSION.CAMPAIGNS_STATS,
  PERMISSION.TEMPLATES_LIST,
  PERMISSION.TEMPLATES_CREATE,
  PERMISSION.TEMPLATES_TOGGLE,
  PERMISSION.TEMPLATES_SYNC,
  PERMISSION.TEMPLATES_STATS,
  PERMISSION.TEMPLATES_DUPLICATE,
  PERMISSION.LEADS_LIST,
  PERMISSION.SETTINGS_AI_PROMPT,
  PERMISSION.SETTINGS_BUSINESS_HOURS,
];

const SUPERVISOR: PermissionCode[] = [
  PERMISSION.CONVERSATIONS_MANAGE,
  PERMISSION.CONVERSATIONS_ASSIGN,
  PERMISSION.CONVERSATIONS_STATS_GLOBAL,
  PERMISSION.CONVERSATIONS_STATS_OWN,
  PERMISSION.CONVERSATIONS_EXPORT,
  PERMISSION.CONTACTS_MANAGE,
  PERMISSION.SEGMENTS_LIST,
  PERMISSION.SEGMENTS_VIEW_CONTACTS,
  PERMISSION.SEGMENTS_ASSIGN,
  PERMISSION.SEGMENTS_ASSIGN_BULK,
  PERMISSION.ATTRIBUTES_LIST,
  PERMISSION.ATTRIBUTES_ASSIGN,
  PERMISSION.ATTRIBUTES_ASSIGN_BULK,
  PERMISSION.CAMPAIGNS_LIST,
  PERMISSION.CAMPAIGNS_STATS,
  PERMISSION.TEMPLATES_LIST,
  PERMISSION.TEMPLATES_STATS,
  PERMISSION.FLOWS_LIST,
  PERMISSION.FLOWS_TOGGLE,
  PERMISSION.LEADS_LIST,
  PERMISSION.SETTINGS_INTEGRATION,
  PERMISSION.SETTINGS_AUDIT,
  PERMISSION.SETTINGS_REPORTS,
];

const COORDINADOR: PermissionCode[] = uniq([
  ...SUPERVISOR,
  PERMISSION.CONTACTS_IMPORT,
  PERMISSION.CONTACTS_EXPORT,
  PERMISSION.SEGMENTS_MANAGE,
  PERMISSION.ATTRIBUTES_MANAGE,
  PERMISSION.CAMPAIGNS_CREATE,
  PERMISSION.TEMPLATES_CREATE,
  PERMISSION.TEMPLATES_TOGGLE,
  PERMISSION.FLOWS_MANAGE,
  PERMISSION.SETTINGS_AI_PROMPT,
  PERMISSION.SETTINGS_BUSINESS_HOURS,
]);

/** Mapa rol → permisos (fuente de verdad v1). */
export const ROLE_PERMISSIONS: Record<RoleSlug, readonly PermissionCode[]> = {
  asesor_comercial: ASESOR,
  analista: ANALISTA,
  gestor: GESTOR,
  supervisor: SUPERVISOR,
  coordinador: COORDINADOR,
  master: ALL_PERMISSION_CODES,
};

export function permissionsForRole(role: RoleSlug): PermissionCode[] {
  return [...ROLE_PERMISSIONS[role]];
}

/** Flags legacy derivados de permisos (compat AuthUser / BD). */
export type LegacyPermissionFlags = {
  can_edit_ai_prompt: boolean;
  can_view_audit_logs: boolean;
  can_view_integration: boolean;
  can_edit_business_hours: boolean;
  can_view_reports: boolean;
  can_assign_conversations: boolean;
  can_manage_attributes: boolean;
  can_manage_segments: boolean;
  can_view_conversation_stats: boolean;
  can_view_campaign_stats: boolean;
  can_manage_leads: boolean;
};

export function legacyFlagsFromPermissions(
  permissions: readonly PermissionCode[],
): LegacyPermissionFlags {
  const set = new Set(permissions);
  return {
    can_edit_ai_prompt: set.has(PERMISSION.SETTINGS_AI_PROMPT),
    can_view_audit_logs: set.has(PERMISSION.SETTINGS_AUDIT),
    can_view_integration: set.has(PERMISSION.SETTINGS_INTEGRATION),
    can_edit_business_hours: set.has(PERMISSION.SETTINGS_BUSINESS_HOURS),
    can_view_reports: set.has(PERMISSION.SETTINGS_REPORTS),
    can_assign_conversations: set.has(PERMISSION.CONVERSATIONS_ASSIGN),
    can_manage_attributes: set.has(PERMISSION.ATTRIBUTES_MANAGE),
    can_manage_segments: set.has(PERMISSION.SEGMENTS_MANAGE),
    can_view_conversation_stats: set.has(PERMISSION.CONVERSATIONS_STATS_GLOBAL),
    can_view_campaign_stats: set.has(PERMISSION.CAMPAIGNS_STATS),
    can_manage_leads: set.has(PERMISSION.LEADS_LIST),
  };
}

/** Inferir permisos mínimos desde flags legacy (usuarios sin role_slug). */
export function permissionsFromLegacyFlags(flags: {
  can_edit_ai_prompt?: boolean;
  can_view_audit_logs?: boolean;
  can_view_integration?: boolean;
  can_edit_business_hours?: boolean;
  can_view_reports?: boolean;
  can_assign_conversations?: boolean;
  can_manage_attributes?: boolean;
  can_manage_segments?: boolean;
  can_view_conversation_stats?: boolean;
  can_view_campaign_stats?: boolean;
  can_manage_leads?: boolean;
}): PermissionCode[] {
  const out: PermissionCode[] = [];
  // Sin rol: mantener acceso histórico al inbox/campañas/plantillas/flujos/contactos
  // para no romper usuarios no migrados (provisionados).
  out.push(
    PERMISSION.CONVERSATIONS_MANAGE,
    PERMISSION.CONVERSATIONS_STATS_OWN,
    PERMISSION.CONVERSATIONS_EXPORT,
    PERMISSION.CONTACTS_MANAGE,
    PERMISSION.CONTACTS_IMPORT,
    PERMISSION.CONTACTS_EXPORT,
    PERMISSION.CAMPAIGNS_LIST,
    PERMISSION.CAMPAIGNS_CREATE,
    PERMISSION.TEMPLATES_LIST,
    PERMISSION.TEMPLATES_CREATE,
    PERMISSION.TEMPLATES_TOGGLE,
    PERMISSION.TEMPLATES_SYNC,
    PERMISSION.TEMPLATES_STATS,
    PERMISSION.TEMPLATES_DUPLICATE,
    PERMISSION.FLOWS_LIST,
    PERMISSION.FLOWS_MANAGE,
    PERMISSION.FLOWS_TOGGLE,
    PERMISSION.SEGMENTS_LIST,
    PERMISSION.SEGMENTS_ASSIGN,
    PERMISSION.SEGMENTS_ASSIGN_BULK,
    PERMISSION.ATTRIBUTES_LIST,
    PERMISSION.ATTRIBUTES_ASSIGN,
    PERMISSION.ATTRIBUTES_ASSIGN_BULK,
  );
  if (flags.can_edit_ai_prompt) out.push(PERMISSION.SETTINGS_AI_PROMPT);
  if (flags.can_view_audit_logs) out.push(PERMISSION.SETTINGS_AUDIT);
  if (flags.can_view_integration) out.push(PERMISSION.SETTINGS_INTEGRATION);
  if (flags.can_edit_business_hours) {
    out.push(PERMISSION.SETTINGS_BUSINESS_HOURS);
  }
  if (flags.can_view_reports) out.push(PERMISSION.SETTINGS_REPORTS);
  if (flags.can_assign_conversations) {
    out.push(PERMISSION.CONVERSATIONS_ASSIGN);
  }
  if (flags.can_manage_attributes) {
    out.push(PERMISSION.ATTRIBUTES_MANAGE, PERMISSION.ATTRIBUTES_LIST);
  }
  if (flags.can_manage_segments) {
    out.push(
      PERMISSION.SEGMENTS_MANAGE,
      PERMISSION.SEGMENTS_LIST,
      PERMISSION.SEGMENTS_VIEW_CONTACTS,
    );
  }
  if (flags.can_view_conversation_stats) {
    out.push(PERMISSION.CONVERSATIONS_STATS_GLOBAL);
  }
  if (flags.can_view_campaign_stats) out.push(PERMISSION.CAMPAIGNS_STATS);
  if (flags.can_manage_leads) out.push(PERMISSION.LEADS_LIST);
  return uniq(out);
}
