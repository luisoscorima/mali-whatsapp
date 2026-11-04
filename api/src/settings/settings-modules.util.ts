import type { AuthUser } from '../auth/auth.types';
import { canonicalBusinessArea } from '../config/areas';

export type SettingsNavGroup = 'ajustes' | 'reportes';

export const SETTINGS_MODULES = [
  {
    id: 'integracion',
    path: '/settings/integracion',
    title: 'Integración',
    preview: 'Webhook, API y documentación',
    userFlag: 'canViewIntegration' as const,
    navGroup: 'ajustes' as const,
  },
  {
    id: 'ia',
    path: '/settings/ia',
    title: 'Respuesta automática (IA)',
    preview: 'Prompt y palabra de transferencia',
    userFlag: 'canEditAiPrompt' as const,
    navGroup: 'ajustes' as const,
  },
  {
    id: 'fuera-de-horario',
    path: '/settings/fuera-de-horario',
    title: 'Fuera de horario',
    preview: 'Horario y mensaje automático',
    userFlag: 'canEditBusinessHours' as const,
    navGroup: 'ajustes' as const,
  },
  {
    id: 'sla',
    path: '/settings/sla',
    title: 'SLA primera respuesta',
    preview: 'Meta y horario de atención Educación',
    userFlag: 'canEditBusinessHours' as const,
    navGroup: 'ajustes' as const,
    requiresEducation: true,
  },
  {
    id: 'bitacora',
    path: '/reports/bitacora',
    title: 'Bitácora del área',
    preview: 'Eventos de su área',
    userFlag: 'canViewAuditLogs' as const,
    navGroup: 'reportes' as const,
  },
  {
    id: 'reporteria',
    path: '/reports/reporteria',
    title: 'Reportería',
    preview: 'Comunicaciones, chat y SLA',
    userFlag: 'canViewReports' as const,
    navGroup: 'reportes' as const,
  },
] as const;

export type SettingsModuleId = (typeof SETTINGS_MODULES)[number]['id'];

function userHasEducationAccess(user: AuthUser): boolean {
  if (canonicalBusinessArea(user.area) === 'educacion') return true;
  return (user.allowedAreas ?? []).some(
    (area) => canonicalBusinessArea(area) === 'educacion',
  );
}

export function userCanAccessSettingsModule(
  user: AuthUser,
  moduleId: string,
): boolean {
  const mod = SETTINGS_MODULES.find((m) => m.id === moduleId);
  if (!mod) return false;
  if (
    'requiresEducation' in mod &&
    mod.requiresEducation &&
    !user.isMaster &&
    !userHasEducationAccess(user)
  ) {
    return false;
  }
  if (user.isMaster) return true;
  return Boolean(user[mod.userFlag]);
}

export function visibleSettingsModules(
  user: AuthUser,
  navGroup?: SettingsNavGroup,
) {
  return SETTINGS_MODULES.filter((m) => {
    if (navGroup && m.navGroup !== navGroup) return false;
    return userCanAccessSettingsModule(user, m.id);
  });
}

export function firstSettingsModulePath(
  user: AuthUser,
  navGroup?: SettingsNavGroup,
): string | null {
  const mods = visibleSettingsModules(user, navGroup);
  return mods.length > 0 ? mods[0].path : null;
}

export function userCanAccessNavGroup(
  user: AuthUser,
  navGroup: SettingsNavGroup,
): boolean {
  return visibleSettingsModules(user, navGroup).length > 0;
}
