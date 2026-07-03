import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import {
  BUSINESS_AREAS,
  isValidBusinessArea,
  normalizeArea,
  type BusinessArea,
} from '../config/areas';
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

  async fetchAllowedAreasForUser(input: {
    userId: number;
    primaryArea: BusinessArea;
    isMaster: boolean;
  }): Promise<BusinessArea[]> {
    if (input.isMaster) return [...BUSINESS_AREAS];
    const extras = await this.fetchExtraAreasForUser(input.userId);
    return this.mergeAllowedAreas(input.primaryArea, extras);
  }

  resolveActiveArea(
    sessionArea: unknown,
    primaryArea: BusinessArea,
    allowedAreas: BusinessArea[],
  ): BusinessArea {
    const primary = normalizeArea(primaryArea);
    const allowed =
      allowedAreas.length > 0 ? allowedAreas : [primary];
    const candidate = normalizeArea(sessionArea);
    if (allowed.includes(candidate)) return candidate;
    return primary;
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
    isMaster: boolean;
    mustChangePassword: boolean;
    canEditAiPrompt: boolean;
    canViewAuditLogs: boolean;
    canViewIntegration: boolean;
    canEditBusinessHours: boolean;
    canViewReports: boolean;
  } {
    const area = normalizeArea(this.config.devArea);
    return {
      id: 0,
      email: 'dev@mali.pe',
      area,
      allowedAreas: [area],
      isMaster: false,
      mustChangePassword: false,
      canEditAiPrompt: false,
      canViewAuditLogs: false,
      canViewIntegration: false,
      canEditBusinessHours: false,
      canViewReports: false,
    };
  }
}
