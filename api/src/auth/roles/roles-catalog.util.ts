import {
  ALL_PERMISSION_CODES,
  type PermissionCode,
} from './permission-codes';
import {
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLE_SLUGS,
  type RoleSlug,
} from './role-permissions';

export const PERMISSION_LABELS: Record<PermissionCode, string> = {
  'conversations.manage': 'Gestionar conversaciones (listar, leer, responder, archivar)',
  'conversations.assign': 'Asignar conversaciones',
  'conversations.stats_global': 'Estadísticas globales de conversaciones',
  'conversations.stats_own': 'Estadísticas personales de conversaciones',
  'conversations.export': 'Exportar conversación (Excel)',
  'contacts.manage': 'Gestionar contactos',
  'contacts.create': 'Crear contactos',
  'contacts.update': 'Editar contactos',
  'contacts.import': 'Importar contactos',
  'contacts.export': 'Exportar contactos',
  'segments.list': 'Listar segmentos',
  'segments.manage': 'Crear / editar / eliminar segmentos',
  'segments.view_contacts': 'Ver contactos del segmento',
  'segments.assign': 'Asignar segmentos (individual)',
  'segments.assign_bulk': 'Asignar segmentos (masivo)',
  'attributes.list': 'Listar atributos',
  'attributes.manage': 'Crear / editar / eliminar atributos',
  'attributes.assign': 'Asignar atributos (individual)',
  'attributes.assign_bulk': 'Asignar atributos (masivo)',
  'campaigns.list': 'Listar / ver campañas',
  'campaigns.create': 'Crear campañas',
  'campaigns.stats': 'Estadísticas de campañas',
  'templates.list': 'Listar / ver plantillas',
  'templates.create': 'Crear plantillas',
  'templates.toggle': 'Activar / desactivar plantillas',
  'templates.sync': 'Sincronizar plantillas desde Meta',
  'templates.stats': 'Estadísticas de plantillas',
  'templates.duplicate': 'Duplicar plantilla',
  'flows.list': 'Listar flujos',
  'flows.manage': 'Crear / editar / eliminar flujos',
  'flows.toggle': 'Activar / pausar flujos',
  'leads.list': 'Listar leads / anuncios',
  'settings.integration': 'Ver integración',
  'settings.ai_prompt': 'Editar prompt IA',
  'settings.business_hours': 'Editar horario',
  'settings.audit': 'Ver bitácora',
  'settings.reports': 'Ver reportería',
};

export type PermissionGroupId =
  | 'conversations'
  | 'contacts'
  | 'segments'
  | 'attributes'
  | 'campaigns'
  | 'templates'
  | 'flows'
  | 'leads'
  | 'settings';

export const PERMISSION_GROUPS: {
  id: PermissionGroupId;
  label: string;
  codes: PermissionCode[];
}[] = [
  {
    id: 'conversations',
    label: 'Conversaciones',
    codes: [
      'conversations.manage',
      'conversations.assign',
      'conversations.stats_global',
      'conversations.stats_own',
      'conversations.export',
    ],
  },
  {
    id: 'contacts',
    label: 'Contactos',
    codes: [
      'contacts.manage',
      'contacts.create',
      'contacts.update',
      'contacts.import',
      'contacts.export',
    ],
  },
  {
    id: 'segments',
    label: 'Segmentos',
    codes: [
      'segments.list',
      'segments.manage',
      'segments.view_contacts',
      'segments.assign',
      'segments.assign_bulk',
    ],
  },
  {
    id: 'attributes',
    label: 'Atributos',
    codes: [
      'attributes.list',
      'attributes.manage',
      'attributes.assign',
      'attributes.assign_bulk',
    ],
  },
  {
    id: 'campaigns',
    label: 'Campañas',
    codes: ['campaigns.list', 'campaigns.create', 'campaigns.stats'],
  },
  {
    id: 'templates',
    label: 'Plantillas',
    codes: [
      'templates.list',
      'templates.create',
      'templates.toggle',
      'templates.sync',
      'templates.stats',
      'templates.duplicate',
    ],
  },
  {
    id: 'flows',
    label: 'Flujos',
    codes: ['flows.list', 'flows.manage', 'flows.toggle'],
  },
  {
    id: 'leads',
    label: 'Leads',
    codes: ['leads.list'],
  },
  {
    id: 'settings',
    label: 'Ajustes',
    codes: [
      'settings.integration',
      'settings.ai_prompt',
      'settings.business_hours',
      'settings.audit',
      'settings.reports',
    ],
  },
];

export type AdminRolesCatalog = {
  readonly: true;
  note: string;
  groups: {
    id: PermissionGroupId;
    label: string;
    permissions: { code: PermissionCode; label: string }[];
  }[];
  roles: {
    slug: RoleSlug;
    label: string;
    permission_codes: PermissionCode[];
  }[];
};

export function buildAdminRolesCatalog(): AdminRolesCatalog {
  return {
    readonly: true,
    note: 'Catálogo definido en código (ROLE_PERMISSIONS). Solo lectura; los cambios van por deploy.',
    groups: PERMISSION_GROUPS.map((group) => ({
      id: group.id,
      label: group.label,
      permissions: group.codes.map((code) => ({
        code,
        label: PERMISSION_LABELS[code],
      })),
    })),
    roles: ROLE_SLUGS.map((slug) => ({
      slug,
      label: ROLE_LABELS[slug],
      permission_codes: [...ROLE_PERMISSIONS[slug]],
    })),
  };
}

/** Asegura que el catálogo de grupos cubre todos los códigos. */
export function assertPermissionCatalogComplete(): void {
  const inGroups = new Set(PERMISSION_GROUPS.flatMap((g) => g.codes));
  for (const code of ALL_PERMISSION_CODES) {
    if (!inGroups.has(code)) {
      throw new Error(`Permiso sin grupo en catálogo admin: ${code}`);
    }
  }
}
