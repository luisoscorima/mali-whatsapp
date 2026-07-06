import { Injectable } from '@nestjs/common';
import {
  AREA_LABELS,
  BUSINESS_AREAS,
  type BusinessArea,
} from '../config/areas';
import { PrismaService } from '../prisma/prisma.service';

export type AdminAreaSummary = {
  slug: BusinessArea;
  label: string;
  users: number;
  contacts: number;
  campaigns: number;
  segments: number;
};

@Injectable()
export class AdminAreasService {
  constructor(private readonly prisma: PrismaService) {}

  async listSummaries(): Promise<AdminAreaSummary[]> {
    const [users, contacts, campaigns, segments] = await Promise.all([
      this.prisma.users.groupBy({ by: ['area'], _count: { _all: true } }),
      this.prisma.contacts.groupBy({ by: ['area'], _count: { _all: true } }),
      this.prisma.campaigns.groupBy({ by: ['area'], _count: { _all: true } }),
      this.prisma.segment_definitions.groupBy({
        by: ['area'],
        _count: { _all: true },
      }),
    ]);

    const usersMap = new Map(users.map((r) => [r.area, r._count._all]));
    const contactsMap = new Map(contacts.map((r) => [r.area, r._count._all]));
    const campaignsMap = new Map(campaigns.map((r) => [r.area, r._count._all]));
    const segmentsMap = new Map(segments.map((r) => [r.area, r._count._all]));

    return BUSINESS_AREAS.map((slug) => ({
      slug,
      label: AREA_LABELS[slug],
      users: usersMap.get(slug) ?? 0,
      contacts: contactsMap.get(slug) ?? 0,
      campaigns: campaignsMap.get(slug) ?? 0,
      segments: segmentsMap.get(slug) ?? 0,
    }));
  }
}
