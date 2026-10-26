import { Injectable, ForbiddenException } from '@nestjs/common';
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
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserAreasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

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

  async replaceExtraAreasForUser(
    userId: number,
    primaryArea: BusinessArea,
    extraAreas: BusinessArea[],
  ): Promise<void> {
    const primary = normalizeArea(primaryArea);
    const extras = (extraAreas ?? [])
      .map((area) => normalizeArea(area))
      .filter((area) => isValidBusinessArea(area) && area !== primary);

    await this.prisma.user_areas.deleteMany({ where: { user_id: userId } });
    if (extras.length > 0) {
      await this.prisma.user_areas.createMany({
        data: extras.map((area) => ({ user_id: userId, area })),
        skipDuplicates: true,
      });
    }
    await this.syncMemberships(userId, primary, extras);
  }

  private async syncMemberships(
    userId: number,
    primary: BusinessArea,
    extras: BusinessArea[],
  ): Promise<void> {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { role_slug: true, is_master: true },
    });
    if (!user || user.is_master) return;
    const slugs = [primary, ...extras].filter((area) => isValidBusinessArea(area));
    const grouped = new Map<string, { program: string | null }[]>();
    for (const slug of slugs) {
      const scope = businessReadScope(slug);
      const current = grouped.get(scope.canonicalArea) ?? [];
      current.push({ program: scope.program });
      grouped.set(scope.canonicalArea, current);
    }
    const areas = await this.prisma.business_areas.findMany({
      where: { slug: { in: [...grouped.keys()] } },
      select: { id: true, slug: true },
    });
    if (!areas.length) return;
    await this.prisma.user_area_memberships.deleteMany({
      where: {
        user_id: userId,
        business_area: { slug: { notIn: [...grouped.keys()] } },
      },
    });
    const roleSlug = user.role_slug || 'asesor_comercial';
    for (const [canonical, grants] of grouped) {
      const area = areas.find((item) => item.slug === canonical);
      if (!area) continue;
      const open = grants.some((grant) => !grant.program);
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
        },
        update: {
          role_slug: roleSlug,
          access_mode: open ? 'all' : 'restricted',
          active: true,
        },
      });
      await this.prisma.user_program_grants.deleteMany({
        where: { membership_id: membership.id },
      });
      if (open) continue;
      const programs = await this.prisma.business_programs.findMany({
        where: {
          business_area_id: area.id,
          active: true,
          slug: { in: grants.map((grant) => grant.program).filter((slug): slug is string => Boolean(slug)) },
        },
        select: { id: true },
      });
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
    return BUSINESS_AREAS.filter(slug => {
      const scope = businessReadScope(slug);
      const membership = memberships.find(m => m.business_area.slug === scope.canonicalArea);
      return membership && (!scope.program || membership.access_mode === 'all' || membership.programs.some(g => g.program.slug === scope.program && g.program.active));
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
    const candidate = normalizeArea(sessionArea);
    if (allowed.includes(candidate)) return candidate;
    return allowed.includes(primary) ? primary : allowed[0];
  }

  async resolveBusinessAccess(userId: number, area: string) {
    const scope = businessReadScope(area);
    const membership = await this.prisma.user_area_memberships.findFirst({
      where: { user_id: userId, business_area: { slug: scope.canonicalArea, active: true }, active: true },
      include: { programs: { include: { program: true } }, lines: true },
    });
    if (!membership) throw new ForbiddenException('Sin membresía activa en el área');
    const programIds = membership.programs.filter(g => g.program.active).map(g => g.program_id);
    const directIds = membership.lines.map(g => g.line_id);
    const lines = await this.prisma.whatsapp_lines.findMany({
      where: { business_area_id: membership.business_area_id,
        ...(membership.access_mode === 'restricted' ? { OR: [{ id: { in: directIds } }, { program_id: { in: programIds } }] } : {}),
      }, select: { id: true },
    });
    return { roleSlug: membership.role_slug, scope: {
      businessAreaId: membership.business_area_id, canonicalArea: scope.canonicalArea,
      mode: membership.access_mode as 'all' | 'restricted', programIds, lineIds: lines.map(l => l.id),
    } };
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
