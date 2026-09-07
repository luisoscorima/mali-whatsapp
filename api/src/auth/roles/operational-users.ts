import type { BusinessArea } from '../../config/areas';
import type { RoleSlug } from './role-permissions';

/** Usuarios operativos a migrar (docs/ROLES-PERMISOS.md). */
export const OPERATIONAL_ROLE_USERS: {
  email: string;
  role: RoleSlug;
  areas: BusinessArea[];
}[] = [
  {
    email: 'achumpitasi@mali.pe',
    role: 'supervisor',
    areas: ['educacion', 'educacion_ep'],
  },
  {
    email: 'asesordeadmision3@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ca'],
  },
  {
    email: 'darias@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ep'],
  },
  {
    email: 'ezurita@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ca'],
  },
  {
    email: 'gzabalbeascoa@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ep'],
  },
  {
    email: 'joropeza@mali.pe',
    role: 'coordinador',
    areas: ['educacion', 'educacion_ca', 'educacion_ep'],
  },
  {
    email: 'kbaumann@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ca', 'educacion_ep'],
  },
  {
    email: 'khuerta@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ca'],
  },
  {
    email: 'kvillegas@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion', 'educacion_ca'],
  },
  {
    email: 'lramirez@mali.pe',
    role: 'supervisor',
    areas: ['educacion', 'educacion_ca', 'educacion_ep'],
  },
  {
    email: 'ngonzales@mali.pe',
    role: 'gestor',
    areas: ['educacion', 'educacion_ca', 'educacion_ep'],
  },
  {
    email: 'ocaceres@mali.pe',
    role: 'analista',
    areas: ['educacion', 'educacion_ca', 'educacion_ep'],
  },
  { email: 'maguinaga@mali.pe', role: 'coordinador', areas: ['pam'] },
  { email: 'mperez@mali.pe', role: 'coordinador', areas: ['patronato'] },
  { email: 'lgutierrez@mali.pe', role: 'coordinador', areas: ['patronato'] },
  { email: 'czegarra@mali.pe', role: 'coordinador', areas: ['patronato'] },
  { email: 'evelazco@mali.pe', role: 'coordinador', areas: ['patronato'] },
];
