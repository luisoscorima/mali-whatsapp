import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from './auth.types';
import { PERMISSION } from './roles/permission-codes';
import { assertPermission, hasPermission } from './roles/has-permission';

export function assertCanManageAttributes(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.ATTRIBUTES_MANAGE,
    'No tienes permiso para gestionar atributos',
  );
}

export function assertCanManageSegments(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.SEGMENTS_MANAGE,
    'No tienes permiso para gestionar segmentos',
  );
}

export function assertCanManageLeads(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.LEADS_LIST,
    'No tienes permiso para gestionar leads',
  );
}

export function assertCanViewCampaignStats(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.CAMPAIGNS_STATS,
    'No tienes permiso para ver estadísticas de campañas',
  );
}

export function assertCanManageConversations(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.CONVERSATIONS_MANAGE,
    'No tienes permiso para gestionar conversaciones',
  );
}

export function assertCanExportConversation(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.CONVERSATIONS_EXPORT,
    'No tienes permiso para exportar conversaciones',
  );
}

export function assertCanManageContacts(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.CONTACTS_MANAGE,
    'No tienes permiso para gestionar contactos',
  );
}

export function assertCanImportContacts(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.CONTACTS_IMPORT,
    'No tienes permiso para importar contactos',
  );
}

export function assertCanExportContacts(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.CONTACTS_EXPORT,
    'No tienes permiso para exportar contactos',
  );
}

export function assertCanListCampaigns(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.CAMPAIGNS_LIST,
    'No tienes permiso para ver campañas',
  );
}

export function assertCanCreateCampaigns(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.CAMPAIGNS_CREATE,
    'No tienes permiso para crear campañas',
  );
}

export function assertCanListTemplates(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.TEMPLATES_LIST,
    'No tienes permiso para ver plantillas',
  );
}

export function assertCanCreateTemplates(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.TEMPLATES_CREATE,
    'No tienes permiso para crear plantillas',
  );
}

export function assertCanListFlows(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.FLOWS_LIST,
    'No tienes permiso para ver flujos',
  );
}

export function assertCanManageFlows(user: AuthUser): void {
  assertPermission(
    user,
    PERMISSION.FLOWS_MANAGE,
    'No tienes permiso para gestionar flujos',
  );
}

export { hasPermission, assertPermission, ForbiddenException };
