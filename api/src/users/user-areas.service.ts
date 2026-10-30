import { BadRequestException, Injectable, ForbiddenException } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import {
  BUSINESS_AREAS,
  businessReadScope,
  isValidBusinessArea,
  normalizeArea,
  type BusinessArea,
} from '../config/areas';
import {
  permissionsForRole,
  type PermissionCode,
} from '../auth/roles';
import type { AuthUser } from '../auth/auth.types';
import { PrismaService } from '../prisma/prisma.service';

const EDUCATION_CATEGORIES = ['general', 'ca', 'ep'] as const;

/** El área Educación del formulario viejo es la categoría General. CA y EP siguen siendo su categoría. */
export function categoriesFromEducationSlugs(slugs: string[]): string[] {
  const found = new Set<string>();
  for (const slug of slugs) {
    if (!isValidBusinessArea(slug)) continue;
    const scope = businessReadScope(slug);
    if (scope.canonicalArea !== 'educacion') continue;
    found.add(scope.program ?? 'general');
  }
  return EDUCATION_CATEGORIES.filter((slug) => found.has(slug));
}

type EducationMembership = {
  access_mode: string;
  include_general: boolean;
  programs: { program: { slug: string; active: boolean } }[];
};

/** null: la membresía todavía es la vieja y hay que leer las áreas marcadas. */
export function explicitEducationCategories(membership: EducationMembership | null): string[] | null {
  if (!membership) return null;
  const explicit = membership.access_mode === 'restricted'
    || membership.include_general
    || membership.programs.length > 0;
  if (!explicit) return null;
  if (membership.access_mode === 'all') {
    const granted = membership.programs
      .filter((grant) => grant.program.active)
      .map((grant) => grant.program.slug);
    // Legacy abierto (sin grants ni include_general): todas las categorías.
    if (!membership.include_general && granted.length === 0) {
      return [...EDUCATION_CATEGORIES];
    }
    if (membership.include_general) granted.unshift('general');
    return granted.length ? [...new Set(granted)] : [...EDUCATION_CATEGORIES];
  }
  const categories = membership.programs
    .filter((grant) => grant.program.active)
    .map((grant) => grant.program.slug);
  if (membership.include_general) categories.unshift('general');
  return [...new Set(categories)];
}

export type UserAccessPlacement = {
  primary: BusinessArea;
  extras: BusinessArea[];
  categories: string[] | null;
};

@Injectable()
export class UserAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /**
   * Categorías del área actual del usuario (general + programas),
   * filtradas por membership / grants. Usable sin permiso de inbox.
   */
  async listEducationCategories(
    user: AuthUser,
  ): Promise<Array<{ slug: string; label: string }>> {
    const canonical = businessReadScope(user.area).canonicalArea;
    const programs = await this.prisma.business_programs.findMany({
      where: {
        active: true,
        business_area: { slug: canonical, active: true },
      },
      orderBy: [{ sort_order: 'asc' }, { slug: 'asc' }],
      select: { slug: true, label: true },
    });
    if (!programs.length && canonical !== 'educacion') return [];
    const all = [
      { slug: 'general', label: 'General' },
      ...programs.map((program) => ({
        slug: program.slug,
        label:
          program.slug === 'ca'
            ? 'Cursos de Arte'
            : program.slug === 'ep'
              ? 'Extensión Profesional'
              : program.label,
      })),
    ];
    if (user.isMaster) return all;
    const membership = await this.prisma.user_area_memberships.findFirst({
      where: {
        user_id: user.id,
        active: true,
        business_area: { slug: canonical },
      },
      include: { programs: { include: { program: true } } },
    });
    if (canonical === 'educacion') {
      const marked = await this.prisma.users.findUnique({
        where: { id: user.id },
        select: { area: true, user_areas: { select: { area: true } } },
      });
      const inherited = categoriesFromEducationSlugs([
        marked?.area ?? '',
        ...(marked?.user_areas ?? []).map((item) => item.area),
      ]);
      const explicit = explicitEducationCategories(membership);
      const allowed = new Set(explicit ?? inherited);
      // Membresía explícita vacía = sin categorías (no abrir todas).
      if (explicit && !allowed.size) return [];
      if (!allowed.size || all.every((item) => allowed.has(item.slug))) return all;
      return all.filter((item) => allowed.has(item.slug));
    }
    if (!membership || membership.access_mode !== 'restricted') return all;
    const allowed = new Set([
      ...(membership.include_general ? ['general'] : []),
      ...membership.programs
        .filter((grant) => grant.program.active)
        .map((grant) => grant.program.slug),
    ]);
    if (!allowed.size || all.every((item) => allowed.has(item.slug))) return all;
    return all.filter((item) => allowed.has(item.slug));
  }

  mergeAllowedAreas(
    primaryArea: BusinessArea,
    extraAreas: BusinessArea[],
  ): BusinessArea[] {
    const set = new Set<BusinessArea>();
    const primary = normalizeArea(primaryArea);
    if (isValidBusinessArea(primary)) set.add(primary);
    for (const item of extraAreas) {
      const area = normalizeArea(item);
      if (isValidBusinessArea(area)) set.add(area);
    }
    return Array.from(set);
  }

  async fetchExtraAreasForUser(userId: number): Promise<BusinessArea[]> {
    const rows = await this.prisma.user_areas.findMany({
      where: { user_id: userId },
      orderBy: { area: 'asc' },
      select: { area: true },
    });
    return rows
      .map((row) => normalizeArea(row.area))
      .filter((area) => isValidBusinessArea(area));
  }

  resolvePlacement(
    primaryArea: string,
    extraAreas: string[] | undefined,
    categories: string[] | undefined,
  ): UserAccessPlacement {
    const raw = [primaryArea, ...(extraAreas ?? [])].map((area) => normalizeArea(area));
    const scopes = raw.filter((area) => isValidBusinessArea(area)).map((area) => businessReadScope(area));
    if (!scopes.length) throw new BadRequestException('Area invalida');
    const primary = scopes[0].canonicalArea;
    if (!isValidBusinessArea(primary)) throw new BadRequestException('Area invalida');
    const extras = [...new Set(scopes.slice(1).map((scope) => scope.canonicalArea))]
      .filter((area) => area !== primary && isValidBusinessArea(area));
    const education = scopes.some((scope) => scope.canonicalArea === 'educacion');
    if (!education) return { primary, extras, categories: null };
    const requested = (categories ?? [])
      .map((slug) => slug.trim().toLowerCase())
      .filter((slug) => slug === 'general' || /^[a-z][a-z0-9_]{0,9}$/.test(slug));
    const selected = categories
      ? [...new Set(requested)]
      : categoriesFromEducationSlugs(raw.filter((area) => isValidBusinessArea(area)));
    if (!selected.length) throw new BadRequestException('Elige al menos una categoría');
    return { primary, extras, categories: selected };
  }

  async presentForAdmin(userId: number, primaryArea: string): Promise<UserAccessPlacement> {
    const extras = await this.fetchExtraAreasForUser(userId);
    const placement = this.resolvePlacement(primaryArea, extras, undefined);
    const membership = await this.prisma.user_area_memberships.findFirst({
      where: { user_id: userId, active: true, business_area: { slug: 'educacion' } },
      include: { programs: { include: { program: true } } },
    });
    if (!placement.categories) return placement;
    const explicit = explicitEducationCategories(membership);
    return { ...placement, categories: explicit ?? placement.categories };
  }

  async replaceExtraAreasForUser(
    userId: number,
    placement: UserAccessPlacement,
  ): Promise<void> {
    const { primary, extras } = placement;
    await this.prisma.user_areas.deleteMany({ where: { user_id: userId } });
    if (extras.length > 0) {
      await this.prisma.user_areas.createMany({
        data: extras.map((area) => ({ user_id: userId, area })),
        skipDuplicates: true,
      });
    }
    await this.syncMemberships(userId, primary, extras, placement.categories);
  }

  private async syncMemberships(
    userId: number,
    primary: BusinessArea,
    extras: BusinessArea[],
    educationCategories: string[] | null,
  ): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { role_slug: true, is_master: true },
    });
    if (!user || user.is_master) return;
    const slugs = [primary, ...extras].filter((area) => isValidBusinessArea(area));
    const areas = await this.prisma.business_areas.findMany({
      where: { slug: { in: slugs } },
      select: { id: true, slug: true },
    });
    if (!areas.length) return;
    await this.prisma.user_area_memberships.deleteMany({
      where: {
        user_id: userId,
        business_area: { slug: { notIn: slugs } },
      },
    });
    const roleSlug = user.role_slug || 'asesor_comercial';
    const selected = educationCategories ?? [];
    const activePrograms = await this.prisma.business_programs.findMany({
      where: { active: true, business_area: { slug: 'educacion' } },
      select: { slug: true },
    });
    const catalog = ['general', ...activePrograms.map((item) => item.slug)];
    const educationOpen = selected.length > 0 && catalog.every((slug) => selected.includes(slug));
    for (const slug of slugs) {
      const area = areas.find((item) => item.slug === slug);
      if (!area) continue;
      const education = slug === 'educacion';
      const open = !education || educationOpen;
      const membership = await this.prisma.user_area_memberships.upsert({
        where: {
          user_id_business_area_id: {
            user_id: userId,
            business_area_id: area.id,
          },
        },
        create: {
          user_id: userId,
          business_area_id: area.id,
          role_slug: roleSlug,
          access_mode: open ? 'all' : 'restricted',
          include_general: education && selected.includes('general'),
        },
        update: {
          role_slug: roleSlug,
          access_mode: open ? 'all' : 'restricted',
          include_general: education && selected.includes('general'),
          active: true,
        },
      });
      await this.prisma.user_program_grants.deleteMany({
        where: { membership_id: membership.id },
      });
      if (!education) continue;
      const wanted = selected.filter((item) => item !== 'general');
      const programs = await this.prisma.business_programs.findMany({
        where: {
          business_area_id: area.id,
          active: true,
          slug: { in: wanted },
        },
        select: { id: true },
      });
      if (programs.length !== wanted.length) {
        throw new BadRequestException('Categoría no válida');
      }
      if (!programs.length) continue;
      await this.prisma.user_program_grants.createMany({
        data: programs.map((program) => ({
          membership_id: membership.id,
          program_id: program.id,
        })),
        skipDuplicates: true,
      });
    }
  }

  async fetchAllowedAreasForUser(input: {
    userId: number;
    primaryArea: BusinessArea;
    isMaster: boolean;
  }): Promise<BusinessArea[]> {
    if (input.isMaster) return [...BUSINESS_AREAS];
    const memberships = await this.prisma.user_area_memberships.findMany({
      where: { user_id: input.userId, active: true, business_area: { active: true } },
      include: { business_area: true, programs: { include: { program: true } } },
    });
    const marked = categoriesFromEducationSlugs(await this.areaSlugsForUser(input.userId));
    return BUSINESS_AREAS.filter(slug => {
      const scope = businessReadScope(slug);
      const membership = memberships.find(m => m.business_area.slug === scope.canonicalArea);
      if (!membership) return false;
      if (scope.canonicalArea !== 'educacion') return true;
      const categories = explicitEducationCategories(membership) ?? marked;
      const open = !categories.length || EDUCATION_CATEGORIES.every((item) => categories.includes(item));
      if (open || !scope.program) return true;
      return categories.includes(scope.program);
    });

  }

  resolveActiveArea(
    sessionArea: unknown,
    primaryArea: BusinessArea,
    allowedAreas: BusinessArea[],
  ): BusinessArea {
    const primary = normalizeArea(primaryArea);
    const allowed = allowedAreas.filter(isValidBusinessArea);
    if (!allowed.length) throw new ForbiddenException('No tienes acceso a un área activa');
    let candidate = normalizeArea(sessionArea);
    if (!allowed.includes(candidate)) {
      candidate = allowed.includes(primary) ? primary : allowed[0];
    }
    if (isValidBusinessArea(candidate)) {
      const canonical = businessReadScope(candidate).canonicalArea;
      if (canonical !== candidate && allowed.includes(canonical)) return canonical;
    }
    return candidate;
  }

  async resolveBusinessAccess(userId: number, area: string) {
    const scope = businessReadScope(area);
    const membership = await this.prisma.user_area_memberships.findFirst({
      where: { user_id: userId, business_area: { slug: scope.canonicalArea, active: true }, active: true },
      include: { programs: { include: { program: true } }, lines: true },
    });
    if (!membership) throw new ForbiddenException('Sin membresía activa en el área');
    let programIds = membership.programs.filter(g => g.program.active).map(g => g.program_id);
    const directIds = membership.lines.map(g => g.line_id);
    let restricted = membership.access_mode === 'restricted';
    let includeGeneral = membership.include_general;
    let categorySlugs: string[] | null = restricted
      ? [
          ...(includeGeneral ? ['general'] : []),
          ...membership.programs.filter((grant) => grant.program.active).map((grant) => grant.program.slug),
        ]
      : null;
    if (scope.canonicalArea === 'educacion') {
      const inherited = explicitEducationCategories(membership)
        ?? categoriesFromEducationSlugs(await this.areaSlugsForUser(userId));
      const activePrograms = await this.prisma.business_programs.findMany({
        where: { business_area_id: membership.business_area_id, active: true },
        select: { id: true, slug: true },
      });
      const coversAll = inherited.length > 0
        && ['general', ...activePrograms.map((item) => item.slug)].every((slug) => inherited.includes(slug));
      if (!coversAll && inherited.length) {
        restricted = true;
        includeGeneral = inherited.includes('general');
        categorySlugs = inherited;
        programIds = activePrograms
          .filter((program) => inherited.includes(program.slug))
          .map((program) => program.id);
      }
    } else if (restricted && (!categorySlugs || !categorySlugs.length)) {
      categorySlugs = ['__none__'];
    }
    const lineOr = [
      ...(membership.access_mode === 'restricted' && directIds.length ? [{ id: { in: directIds } }] : []),
      ...(programIds.length ? [{ program_id: { in: programIds } }] : []),
      ...(includeGeneral ? [{ program_id: null }] : []),
    ];
    const lines = await this.prisma.whatsapp_lines.findMany({
      where: {
        business_area_id: membership.business_area_id,
        ...(restricted ? { OR: lineOr.length ? lineOr : [{ id: -1 }] } : {}),
      },
      select: { id: true },
    });
    return { roleSlug: membership.role_slug, scope: {
      businessAreaId: membership.business_area_id, canonicalArea: scope.canonicalArea,
      mode: (restricted ? 'restricted' : 'all') as 'all' | 'restricted', programIds, lineIds: lines.map(l => l.id),
      categorySlugs,
    } };
  }

  private async areaSlugsForUser(userId: number): Promise<string[]> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { area: true },
    });
    const extras = await this.fetchExtraAreasForUser(userId);
    return [user?.area ?? '', ...extras];
  }

  canAccessArea(
    user: { isMaster: boolean; area: BusinessArea; allowedAreas?: BusinessArea[] },
    area: unknown,
  ): boolean {
    if (user.isMaster) return isValidBusinessArea(area);
    const allowed = user.allowedAreas?.length
      ? user.allowedAreas
      : [user.area];
    return allowed.includes(normalizeArea(area));
  }

  getDevUser(): {
    id: number;
    email: string;
    area: BusinessArea;
    allowedAreas: BusinessArea[];
    roleSlug: 'coordinador';
    permissions: PermissionCode[];
    isMaster: boolean;
    isProvisioned: boolean;
    isBootstrapAdmin: boolean;
    mustChangePassword: boolean;
    canEditAiPrompt: boolean;
    canViewAuditLogs: boolean;
    canViewIntegration: boolean;
    canEditBusinessHours: boolean;
    canViewReports: boolean;
    canAssignConversations: boolean;
    canManageAttributes: boolean;
    canManageSegments: boolean;
    canViewConversationStats: boolean;
    canViewCampaignStats: boolean;
    canManageLeads: boolean;
  } {
    const area = normalizeArea(this.config.devArea);
    const permissions = permissionsForRole('coordinador');
    return {
      id: 0,
      email: 'dev@mali.pe',
      area,
      allowedAreas: [area],
      roleSlug: 'coordinador',
      permissions,
      isMaster: false,
      isProvisioned: true,
      isBootstrapAdmin: false,
      mustChangePassword: false,
      canEditAiPrompt: true,
      canViewAuditLogs: true,
      canViewIntegration: true,
      canEditBusinessHours: true,
      canViewReports: true,
      canAssignConversations: true,
      canManageAttributes: true,
      canManageSegments: true,
      canViewConversationStats: true,
      canViewCampaignStats: true,
      canManageLeads: true,
    };
  }
}
