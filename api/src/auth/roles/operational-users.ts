import type { BusinessArea } from '../../config/areas';
import type { RoleSlug } from './role-permissions';

/** Usuarios operativos a migrar (docs/ROLES.md). */
export const OPERATIONAL_ROLE_USERS: {
  email: string;
  role: RoleSlug;
  areas: BusinessArea[];
  /** Categorías de Educación (general / ca / ep). */
  categories?: string[];
}[] = [
  {
    email: 'achumpitasi@mali.pe',
    role: 'supervisor',
    areas: ['educacion'],
    categories: ['general', 'ep'],
  },
  {
    email: 'asesordeadmision3@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion'],
    categories: ['general', 'ca'],
  },
  {
    email: 'darias@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion'],
    categories: ['general', 'ep'],
  },
  {
    email: 'ezurita@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion'],
    categories: ['general', 'ca'],
  },
  {
    email: 'gzabalbeascoa@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion'],
    categories: ['general', 'ep'],
  },
  {
    email: 'joropeza@mali.pe',
    role: 'coordinador',
    areas: ['educacion'],
    categories: [],
  },
  {
    email: 'kbaumann@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion'],
    categories: ['general', 'ca', 'ep'],
  },
  {
    email: 'khuerta@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion'],
    categories: ['general', 'ca'],
  },
  {
    email: 'kvillegas@mali.pe',
    role: 'asesor_comercial',
    areas: ['educacion'],
    categories: ['general', 'ca'],
  },
  {
    email: 'lramirez@mali.pe',
    role: 'supervisor',
    areas: ['educacion'],
    categories: ['general', 'ca', 'ep'],
  },
  {
    email: 'ngonzales@mali.pe',
    role: 'gestor',
    areas: ['educacion'],
    categories: ['general', 'ca', 'ep'],
  },
  {
    email: 'ocaceres@mali.pe',
    role: 'analista',
    areas: ['educacion'],
    categories: ['general', 'ca', 'ep'],
  },
  { email: 'maguinaga@mali.pe', role: 'coordinador', areas: ['pam'] },
  { email: 'mperez@mali.pe', role: 'coordinador', areas: ['patronato'] },
  { email: 'lgutierrez@mali.pe', role: 'coordinador', areas: ['patronato'] },
  { email: 'czegarra@mali.pe', role: 'coordinador', areas: ['patronato'] },
  { email: 'evelazco@mali.pe', role: 'coordinador', areas: ['patronato'] },
];
